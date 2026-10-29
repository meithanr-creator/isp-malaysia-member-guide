import { beforeUserCreated } from 'firebase-functions/v2/identity';
import { requireMembershipInvitationHandler } from './invitation.js';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, onRequest } from 'firebase-functions/v2/https';
import * as content from './content.js';
import * as registry from './registry.js';
import { activateMyMembershipHandler } from './enrollment.js';
import { downloadContentFileHandler, DOWNLOAD_ORIGINS } from './download.js';

setGlobalOptions({serviceAccount:'isp-functions@isp-planter-app.iam.gserviceaccount.com',region:'asia-southeast1',minInstances:0,maxInstances:2,concurrency:4,memory:'256MiB',timeoutSeconds:120});
export const saveContentDraft=onCall(content.saveContentDraftHandler);
export const previewContentDraft=onCall(content.previewContentDraftHandler);
export const publishContentDraft=onCall(content.publishContentDraftHandler);
export const listContentDrafts=onCall(content.listContentDraftsHandler);
export const prepareContentUpload=onCall(content.prepareContentUploadHandler);
export const finalizeContentUpload=onCall(content.finalizeContentUploadHandler);
export const getContentFile=onCall(content.getContentFileHandler);
export const submitConsultation=onCall(content.submitConsultationHandler);
export const saveEventInterest=onCall(content.saveEventInterestHandler);
export const withdrawEventInterest=onCall(content.withdrawEventInterestHandler);
export const listMyConsultations=onCall(request=>content.listOwnHandler(request,'consultations'));
export const listMyEventInterests=onCall(request=>content.listOwnHandler(request,'eventInterests'));
export const listAdminConsultations=onCall(content.listAdminConsultationsHandler);
export const previewRegistryImport=onCall(registry.previewRegistryImportHandler);
export const getRegistryImportPreview=onCall(registry.getRegistryImportPreviewHandler);
export const confirmRegistryImport=onCall(registry.confirmRegistryImportHandler);
export const listRegistry=onCall(registry.listRegistryHandler);

export const downloadContentFile=onRequest({cors:DOWNLOAD_ORIGINS,concurrency:1},downloadContentFileHandler);




export const activateMyMembership=onCall(activateMyMembershipHandler);


// Only account creation is gated; existing owner/admin sign-in is unchanged.
export const requireMembershipInvitation = beforeUserCreated({ timeoutSeconds: 7 }, requireMembershipInvitationHandler);
