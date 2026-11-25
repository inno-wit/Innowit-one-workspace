import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const adminPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://postgres:postgres@localhost:5432/postgres?schema=public'
    }
  }
});

async function main() {
  console.log('Recreating test database innowit_one_test...');
  try {
    await adminPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "innowit_one_test"`);
    console.log('Dropped existing test database');
  } catch (e) {
    console.log('No existing test database to drop');
  }
  
  await adminPrisma.$executeRawUnsafe(`CREATE DATABASE "innowit_one_test"`);
  console.log('Created innowit_one_test database');
  
  await adminPrisma.$disconnect();
  
  // Run migrations against test database
  console.log('Running migrations against innowit_one_test...');
  try {
    execSync('npx prisma migrate deploy', {
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/innowit_one_test?schema=public'
      },
      stdio: 'inherit',
      cwd: 'C:\\Users\\thee-keem\\Projects\\Innowit-one-workspace'
    });
    console.log('Migrations deployed successfully');
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  }
  
  // Run seed
  console.log('Running seed...');
  try {
    execSync('npx prisma db seed', {
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/innowit_one_test?schema=public'
      },
      stdio: 'inherit',
      cwd: 'C:\\Users\\thee-keem\\Projects\\Innowit-one-workspace'
    });
    console.log('Seed completed');
  } catch (e) {
    console.error('Seed failed:', e);
    process.exit(1);
  }
  
  // Verify database identity
  const testPrisma = new PrismaClient({
    datasources: {
      db: {
        url: 'postgresql://postgres:postgres@localhost:5432/innowit_one_test?schema=public'
      }
    }
  });
  
  const result = await testPrisma.$queryRawUnsafe(`SELECT current_database() as db_name, current_user as db_user, current_setting('server_version') as version`);
  console.log('Database identity:', result);
  
  await testPrisma.$disconnect();
}

main().catch(console.error);