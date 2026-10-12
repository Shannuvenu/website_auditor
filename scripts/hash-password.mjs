// Usage: npm run hash-password   (prompts for the password; nothing is stored or sent anywhere)
import { randomBytes, scrypt } from 'node:crypto';
import readline from 'node:readline';

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = rl._writeToOutput;
    rl._writeToOutput = (s) => (s.startsWith(question) ? write.call(rl, s) : undefined); // mute typed characters
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const password = process.argv[2] ?? (await ask('Password: '));
if (password.length < 12) {
  console.error('Use at least 12 characters.');
  process.exit(1);
}
const N = 16384, r = 8, p = 1;
const salt = randomBytes(16);
scrypt(password, salt, 64, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) => {
  if (err) throw err;
  console.log(`scrypt:${N}:${r}:${p}:${salt.toString('base64url')}:${key.toString('base64url')}`);
});
