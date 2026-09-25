export type DocumentRef = { id: string; version: string; sha256: string };
export type LegalDocument = DocumentRef & {
  title: string;
  fullTitle?: string;
  type: string;
  purpose: string;
  status: string;
  notice: string;
  summary: string[][];
  sections: string[][];
};
export type RegistrationDetails = { name: string; documents: DocumentRef[] };
export type RegistrationPayload = {
  email: string;
  password: string;
  registration?: RegistrationDetails;
  socialIdentity?: import('../auth/entities/social-identity.entity').SocialIdentityRef;
};
