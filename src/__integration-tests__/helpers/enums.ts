export enum HttpMethod {
  Get = 'GET',
  Post = 'POST',
  Put = 'PUT',
  Patch = 'PATCH',
  Delete = 'DELETE',
}

export enum TipWorkflowStep {
  Create = 'create',
  Build = 'build',
  Submit = 'submit',
  Confirm = 'confirm',
  History = 'history',
}

export enum WalletWorkflowStep {
  GenerateNonce = 'generate_nonce',
  GetChallenge = 'get_challenge',
  Verify = 'verify',
  Balance = 'balance',
}

export enum CreatorWorkflowStep {
  RequestVerification = 'request_verification',
  VerificationStatus = 'verification_status',
  Earnings = 'earnings',
  PayoutEligibility = 'payout_eligibility',
}

export enum TipLifecycleStatus {
  Pending = 'pending',
  Confirmed = 'confirmed',
  Failed = 'failed',
}

export enum CreatorVerificationState {
  Pending = 'pending',
  Verified = 'verified',
  Rejected = 'rejected',
}
