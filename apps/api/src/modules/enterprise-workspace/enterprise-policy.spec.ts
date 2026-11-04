import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthorizedCommand } from '../../common/idempotency/command-authorization.js';
import { restrictEnterpriseBusiness } from './enterprise-policy.js';

describe('Independent compliance and enterprise delegation',()=>{
  const input={actor:{sub:'reviewer',organizationId:'inspection-org',role:'COMPLIANCE_REVIEWER'},operation:'REVIEW_CERTIFICATE',payload:{id:'certificate'}} as AuthorizedCommand;
  it.each(['AUDITOR','COMPLIANCE_REVIEWER'])('does not reclassify an authorized %s command using business hierarchy',async role=>{
    const findUnique=vi.fn().mockResolvedValue({enterpriseTier:3});
    await expect(restrictEnterpriseBusiness({user:{findUnique}} as unknown as Prisma.TransactionClient,input,true,role)).resolves.toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });
  it('still refuses a tier-3 business command whose chain scope cannot be resolved',async()=>{
    const findUnique=vi.fn().mockResolvedValue({enterpriseTier:3});
    await expect(restrictEnterpriseBusiness({user:{findUnique}} as unknown as Prisma.TransactionClient,
      {...input,payload:{}},true,'FARM_STAFF')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
