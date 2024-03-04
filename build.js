import fs from 'fs/promises';
import path from 'path';
import Handlebars from 'handlebars';

// Get options from the command line arguments.
const options = {
    assetVersionKey: 'v',
    dataExtension: '.json',
    debug: false,
    outputPath: 'bin',
    partialsPath: 'src/_partials',
    sourcePath: 'src',
    templateExtension: '.hbs',
    virtualDirectory: ''
};
for (let i = 2; i < process.argv.length; i++) {
    switch (process.argv[i]) {
        case '--asset-version-key':
            options.assetVersionKey = process.argv[++i];
            break;
        case '--data-extension':
            options.dataExtension = process.argv[++i];
            break;
        case '--debug':
            options.debug = true;
            break;
        case '--output':
            options.outputPath = process.argv[++i];
            break;
        case '--partials':
            options.partialsPath = process.argv[++i];
            break;
        case '--source':
            options.sourcePath = process.argv[++i];
            break;
        case '--template-extension':
            options.templateExtension = process.argv[++i];
            break;
        case '--virtual-directory':
            options.virtualDirectory = process.argv[++i];
            break;
    }
}

// Split output based on build configuration.
options.outputPath = path.join(options.outputPath, options.debug ? 'debug' : 'release');

// Helper functions.
function changeExtension(filePath, extension) {
    return filePath.substring(0, filePath.length - path.extname(filePath).length) + extension;
}
function getOutputFilePath(sourceFilePath) {
    return path.join(options.outputPath, sourceFilePath.substring(options.sourcePath.length));
}
async function createDirectories(filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
}

// Asset helper.
const assetVersion = Date.now();

Handlebars.registerHelper('asset', assetPath => {
    // Return the path plus a version query string.
    assetPath = Handlebars.escapeExpression(path.posix.join(options.virtualDirectory, assetPath));
    return new Handlebars.SafeString(`${assetPath}?${options.assetVersionKey}=${assetVersion}`);
});

// List helper.
Handlebars.registerHelper('list', items => {
    let list = '';
    if (!items || !items.length)
        return list;
    list = items[0];
    for (var i = 1; i < items.length - 1; i++) {
        list += ', ' + items[i];
    }
    if (items.length > 1) {
        list += ' & ' + items[items.length - 1];
    }
    return list;
});

// Pluralization helper.
Handlebars.registerHelper('pluralize', (singular, arg1, arg2) => {
    let count, plural;
    switch (typeof arg1) {
        case 'number':
            count = arg1;
            plural = singular + 's';
            break;
        case 'string':
            plural = arg1;
            if (typeof arg2 !== 'number') {
                throw new Error('Third argument must be a number.');
            }
            count = arg2;
            break;
        default:
            throw new Error('Invalid arguments.');
    }
    if (count === 1) {
        return singular;
    }
    return typeof plural === 'string' ? plural : singular + 's';
});

// String trim helper.
Handlebars.registerHelper('trim-start', (text, trim) => {
    return text.substring(trim.length);
});

// Star rating helper.
let starGradientId = 0;
Handlebars.registerHelper('stars', function (options) {
    let html = '';
    for (let i = 0; i < 5; i++) {
        const value = Math.min(Math.max(this.rating - i, 0), 1);
        let context;
        switch (value) {
            case 0:
                context = { isFull: false };
                break;
            case 1:
                context = { isFull: true };
                break;
            default:
                context = {
                    partial: {
                        id: 'star-' + starGradientId++,
                        percent: Math.round(value * 100)
                    }
                };
                break;
        }
        html += options.fn(context);
    }
    return html;
});

// Global context.
const globalContext = {
    _debug: options.debug
};

// Clean the output directory.
try {
    await fs.rm(options.outputPath, { recursive: true });
} catch { }

// Find and organize all the source files.
const
    partialTemplatePaths = new Set(),
    fullTemplatePaths = new Set(),
    dataPaths = new Set(),
    contentPaths = new Set();

async function getSourceFilePaths(dirPath) {
    for (const child of await fs.readdir(dirPath, { withFileTypes: true })) {
        const childPath = path.join(dirPath, child.name);
        if (child.isDirectory()) {
            await getSourceFilePaths(childPath);
        } else if (child.isFile()) {
            switch (path.extname(child.name)) {
                case options.templateExtension:
                    if (childPath.startsWith(path.join(options.partialsPath, path.sep))) {
                        partialTemplatePaths.add(childPath);
                    } else {
                        fullTemplatePaths.add(childPath);
                    }
                    break;
                case options.dataExtension:
                    dataPaths.add(childPath);
                    break;
                default:
                    contentPaths.add(childPath);
                    break;
            }
        }
    }
}
await getSourceFilePaths(options.sourcePath);

// Load all the partial templates.
for (const filePath of partialTemplatePaths) {
    Handlebars.registerPartial(
        filePath.substring(
            options.partialsPath.length + 1,
            filePath.length - path.extname(filePath).length
        ),
        await fs.readFile(filePath, 'utf8')
    );
}

// Find and render all the full templates.
for (const filePath of fullTemplatePaths) {
    const
        render = Handlebars.compile(await fs.readFile(filePath, 'utf8')),
        dataPath = changeExtension(filePath, '.json');
    let context = { ...globalContext };
    if (dataPaths.has(dataPath)) {
        context = {
            ...context,
            ...JSON.parse(await fs.readFile(dataPath, 'utf8'))
        };
        dataPaths.delete(dataPath);
    }
    const outputFilePath = getOutputFilePath(changeExtension(filePath, '.html'));
    await createDirectories(outputFilePath);
    await fs.writeFile(outputFilePath, render(context));
}

// Any remaining data files that were not associated with a view should be treated as content.
for (const dataPath of dataPaths) {
    contentPaths.add(dataPath);
}

// Copy all the content files to the output directory.
for (const contentPath of contentPaths) {
    const outputFilePath = getOutputFilePath(contentPath);
    await createDirectories(outputFilePath);
    await fs.copyFile(contentPath, outputFilePath);
}