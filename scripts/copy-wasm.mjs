import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const sourceDir = path.join(projectRoot, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const targetDir = path.join(projectRoot, 'public', 'mediapipe', 'wasm');

if (fs.existsSync(sourceDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  console.log('Successfully copied MediaPipe wasm files to', targetDir);
} else {
  console.warn('MediaPipe wasm source directory not found at', sourceDir);
}
