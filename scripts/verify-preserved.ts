import { verifyPreserved } from '../site/lib/preservation';

console.log(`Verified ${verifyPreserved().size} preserved files without Git history.`);
