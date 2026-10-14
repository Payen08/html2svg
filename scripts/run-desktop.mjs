import {spawn} from 'node:child_process';
const executable='release/mac-arm64/HTML2SVG Artboard.app/Contents/MacOS/HTML2SVG Artboard';
const child=spawn(executable,[],{stdio:'inherit'});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code||0;});
