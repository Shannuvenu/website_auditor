import fs from 'node:fs';
import path from 'node:path';
import { generateMockFixtures } from './mock-generator';

const target = path.resolve(__dirname, '..', 'lib', 'mock', 'fixtures.generated.json');
fs.writeFileSync(target, `${JSON.stringify(generateMockFixtures(), null, 1)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), target)}`);
