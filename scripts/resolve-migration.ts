import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://postgres:postgres@localhost:5432/innowit_one_test?schema=public'
    }
  }
});

async function main() {
  console.log('Resolving failed migration...');
  
  // Mark the failed migration as resolved (rolled back)
  await prisma.$executeRawUnsafe(`
    UPDATE "_prisma_migrations" 
    SET "finished_at" = NOW(), "rolled_back_at" = NOW(), "logs" = 'Resolved manually after dropping table'
    WHERE "migration_name" = '20261124_add_import_job' AND "rolled_back_at" IS NULL
  `);
  
  console.log('Marked failed migration as resolved');
  
  // Also clean up any migration lock
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261124_add_import_job'`);
    console.log('Removed failed migration record');
  } catch (e) {
    console.log('Could not remove migration record:', e);
  }
  
  await prisma.$disconnect();
  console.log('Done');
}

main().catch(console.error);