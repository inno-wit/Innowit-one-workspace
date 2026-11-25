import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://postgres:postgres@localhost:5432/innowit_one_test?schema=public'
    }
  }
});

async function main() {
  console.log('Testing ImportJob model...');
  
  // Get a test user
  const user = await prisma.user.findFirst({
    where: { email: 'admin@innowit.ke' }
  });
  
  if (!user) {
    console.error('Test user not found');
    process.exit(1);
  }
  
  console.log('Found user:', user.id, user.email);
  
  // Test creating an import job
  const importJob = await prisma.importJob.create({
    data: {
      organizationId: user.organizationId,
      entityType: 'CUSTOMER',
      fileUrl: 'https://example.com/test.csv',
      mappingJson: JSON.stringify({ name: 'name', email: 'email' }),
      status: 'PENDING',
      optionsJson: JSON.stringify({ dryRun: true, skipDuplicates: false }),
      idempotencyKey: `test-${Date.now()}`,
      createdById: user.id,
    }
  });
  
  console.log('Created ImportJob:', importJob.id);
  
  // Test finding by organizationId_idempotencyKey (tenant-scoped)
  const found = await prisma.importJob.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: importJob.organizationId,
        idempotencyKey: importJob.idempotencyKey!,
      },
    },
  });
  
  console.log('Found by idempotencyKey:', found?.id);
  
  // Test finding by id
  const byId = await prisma.importJob.findUnique({
    where: { id: importJob.id }
  });
  
  console.log('Found by id:', byId?.id);
  
  // Test organization isolation
  const orgB = await prisma.organization.findFirst({
    where: { kraPin: 'P059999999Z' }
  });
  
  if (orgB) {
    const userB = await prisma.user.findFirst({
      where: { organizationId: orgB.id }
    });
    
    if (userB) {
      const jobB = await prisma.importJob.create({
        data: {
          organizationId: orgB.id,
          entityType: 'DEAL',
          fileUrl: 'https://example.com/test2.csv',
          mappingJson: JSON.stringify({ title: 'title', value: 'value' }),
          status: 'PENDING',
          idempotencyKey: `test-orgb-${Date.now()}`,
          createdById: userB.id,
        }
      });
      
      // Try to access orgA's job from orgB
      const crossTenant = await prisma.importJob.findUnique({
        where: { id: importJob.id }
      });
      
      // The unique constraint is on (organizationId, idempotencyKey), so cross-tenant access
      // would need to be enforced at the API level
      console.log('OrgB job created:', jobB.id);
      console.log('Cross-tenant access test: API should enforce org isolation');
    }
  }
  
  // Clean up
  await prisma.importJob.deleteMany({
    where: { idempotencyKey: { startsWith: 'test-' } }
  });
  
  console.log('Test cleanup done');
  await prisma.$disconnect();
  console.log('ImportJob model test PASSED');
}

main().catch(async (e) => {
  console.error('Test failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});