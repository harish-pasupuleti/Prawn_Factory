// Safety guard run before `npm test`: the test run WIPES the database it points at.
// It refuses to continue unless the database name contains "test".
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test', quiet: true });

const names = {};
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  const value = process.env[key];
  if (!value) {
    console.error(`Refusing to run tests: ${key} is not set in apps/api/.env.test`);
    process.exit(1);
  }
  try {
    names[key] = decodeURIComponent(new URL(value).pathname.replace(/^\//, ''));
  } catch {
    console.error(`Refusing to run tests: ${key} in apps/api/.env.test is not a valid URL`);
    process.exit(1);
  }
}

for (const [key, name] of Object.entries(names)) {
  if (!/test/i.test(name)) {
    console.error(
      `Refusing to run tests: the database in ${key} is "${name}", which does not contain "test".\n` +
        'The test run deletes ALL data in that database. Create a separate database (for example prawn_test) and point apps/api/.env.test at it.',
    );
    process.exit(1);
  }
}
console.log(`Test database check passed (${names.DATABASE_URL}).`);
