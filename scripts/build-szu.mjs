import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bank = JSON.parse(await readFile(path.join(root, 'szu-reviewed-bank.json'), 'utf8'));
const template = await readFile(path.join(root, 'szu-preexam.template.js'), 'utf8');
if (!template.includes('__BANK_JSON__')) throw new Error('Bank placeholder missing.');
const output = template.replace('__BANK_JSON__', JSON.stringify(bank));
await writeFile(path.join(root, 'physics-lab-preexam-szu.user.js'), output);
console.log(`Generated Shenzhen University userscript with ${Object.values(bank).reduce((sum, group) => sum + group.questions.length, 0)} answers.`);
