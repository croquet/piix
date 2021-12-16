#!/bin/sh

rm -rf dist

rsync -r apiKey.js buttonRow.js drawing.css drawing.js pictures.css pictures.js pix2.js style.css landing.js icon.png croquet shell index.html dist
