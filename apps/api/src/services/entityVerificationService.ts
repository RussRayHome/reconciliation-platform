import type { EntityVerificationStatus } from '@recon/domain';

export interface EntityVerificationRequest {
  legalName: string;
  state: string;
  filingNumber: string;
  entityType: 'domestic' | 'foreign';
}

export interface EntityVerificationResult {
  status: Extract<EntityVerificationStatus, 'verified' | 'failed'>;
  registeredName?: string;
  standing?: string;
}

/** Seam for the outside-source Secretary of State entity/filing-number check. No vendor is chosen
 * yet -- callers depend on this interface, not on any concrete provider. */
export interface EntityVerificationProvider {
  verify(request: EntityVerificationRequest): Promise<EntityVerificationResult>;
}

/**
 * Stands in for a real Secretary-of-State lookup vendor. Deterministic so the whole
 * account-created -> pending -> verified/failed path is exercisable without any external
 * dependency: an all-zero or '9999'-containing filing number fails (mirrors the design mockup's
 * own fake SoS logic), anything else passes.
 */
export class MockEntityVerificationProvider implements EntityVerificationProvider {
  /** Fails on an all-zero or '9999'-containing filing number; verifies everything else. */
  verify(request: EntityVerificationRequest): Promise<EntityVerificationResult> {
    const digits = request.filingNumber.replace(/\D/g, '');
    const looksFake = digits.length === 0 || /^0+$/.test(digits) || digits.includes('9999');

    if (looksFake) {
      return Promise.resolve({ status: 'failed' });
    }

    return Promise.resolve({
      status: 'verified',
      registeredName: request.legalName,
      standing: 'active',
    });
  }
}

/**
 * Env-var-keyed factory -- only 'mock' exists today. Swapping in a real vendor later is one new
 * EntityVerificationProvider implementation plus one branch here, not a redesign of any caller.
 */
export const resolveEntityVerificationProvider = (): EntityVerificationProvider => {
  const configured = process.env.ENTITY_VERIFICATION_PROVIDER?.trim().toLowerCase();

  switch (configured) {
    case undefined:
    case '':
    case 'mock':
      return new MockEntityVerificationProvider();
    default:
      throw new Error(
        `Unknown ENTITY_VERIFICATION_PROVIDER "${configured}" -- only "mock" is supported today.`,
      );
  }
};
