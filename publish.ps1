node build.js
aws s3 cp bin/release s3://jeffcamera.com --exclude *.svg --recursive
aws s3 cp bin/release s3://jeffcamera.com --exclude * --include *.svg --content-type image/svg+xml --recursive