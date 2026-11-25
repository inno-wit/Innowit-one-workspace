import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://postgres:postgres@localhost:5432/innowit_one_test?schema=public'
    }
  }
});

async function main() {
  console.log('Dropping ImportJob table and type if they exist...');
  try {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "ImportJob"`);
    console.log('Dropped ImportJob table');
  } catch (e) {
    console.log('ImportJob table drop error (may not exist):', e);
  }
  
  try {
    await prisma.$executeRawUnsafe(`DROP TYPE IF EXISTS "ImportJobStatus"`);
    console.log('Dropped ImportJobStatus type');
  } catch (e) {
    console.log('ImportJobStatus type drop error (may not exist):', e);
  }
  
  await prisma.$disconnect();
  console.log('Done');
}

main().catch(console.error);