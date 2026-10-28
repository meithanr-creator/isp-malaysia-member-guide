import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';

export const KINDS = ['event', 'discover', 'publication'] as const;
export type Kind = typeof KINDS[number];
export type ContentData = Record<string, string | string[] | null>;
export const FORMATS = ['Workshop', 'Field visit', 'Webinar', 'Conference'];
export const TIMEZONES = ['Asia/Kuala_Lumpur', 'Asia/Singapore', 'Asia/Jakarta', 'UTC'];
export const TOPICS = ['Plantation feasibility', 'Operational due diligence', 'Vendor management', 'Cost and inventory optimisation', 'Other enquiry'];
export const DEFAULT_IMAGES = ['plantation-small.jpg', 'planter-cover.jpg', 'member-events.jpg'];
export function fail(message: string): never { throw new HttpsError('invalid-argument', message); }
export function obj(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('A request object is required.');
  const result = value as Record<string, unknown>;
  if (keys && Object.keys(result).some(key => !keys.includes(key))) fail('Unexpected fields are not accepted.');
  return result;
}
export function text(value: unknown, max: number, required = false, oneLine = false): string {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') return fail('Text fields must be strings.');
  const clean = value.trim();
  if (clean.length > max || (required && !clean) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(clean)
    || (oneLine && /[\r\n\t]/u.test(clean))) return fail(`A text field is invalid (maximum ${max} characters).`);
  return clean;
}
export function email(value: unknown): string {
  const clean = text(value, 160, true, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(clean)) fail('A valid email address is required.');
  return clean;
}
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(value)) fail('A valid record identifier is required.');
  return value as string;
}
export function cursorId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/u.test(value)) fail('A valid page cursor is required.');
  return value as string;
}
export function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail('A non-negative revision is required.');
  return value as number;
}
export function kind(value: unknown): Kind {
  if (!KINDS.includes(value as Kind)) fail('Unsupported content type.');
  return value as Kind;
}
export function sha(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
export function date(value: unknown): string {
  const clean = text(value, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(clean) || !Number.isFinite(Date.parse(clean))
    || new Date(`${clean}T00:00:00Z`).toISOString().slice(0, 10) !== clean) fail('A valid ISO date is required.');
  return clean;
}
export function httpsUrl(value: unknown): string {
  const clean = text(value, 2048, true, true);
  if (clean !== value || /[\\\u0000-\u0020\u007f]/u.test(clean) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(clean)) fail('Use a complete HTTPS address without login details.');
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) fail('Use a complete HTTPS address without login details.');
  } catch { fail('Use a complete HTTPS address without login details.'); }
  return clean;
}
const EVENT_LIMITS = { title:110, summary:180, description:4000, audience:240, programme:2500, venue:180, venueDetails:700, bankName:100, accountName:140, accountNumber:60, receiptEmail:160, paymentNotes:1200 };
const EVENT_KEYS = [...Object.keys(EVENT_LIMITS), 'format','date','startsAt','endsAt','timezone','admission','fee','paymentMethod','images','brochure'];
const DISCOVER_KEYS = ['tag','title','description','websiteUrl','imageAlt','defaultImage','image'];
const PUBLICATION_KEYS = ['title','subtitle','description','author','issueDate','cover','pdf'];
function choice(raw: unknown, choices: string[], fallback: string): string {
  const value = raw === undefined ? fallback : text(raw, 80);
  if (!choices.includes(value)) fail('An unsupported choice was supplied.');
  return value;
}
function fileId(raw: unknown): string | null { return raw === null || raw === undefined || raw === '' ? null : id(raw); }
export function normalizeContent(type: Kind, raw: unknown, ready = false): ContentData {
  const source = obj(raw, type === 'event' ? EVENT_KEYS : type === 'discover' ? DISCOVER_KEYS : PUBLICATION_KEYS);
  const output: ContentData = {};
  if (type === 'event') {
    for (const [key, maximum] of Object.entries(EVENT_LIMITS)) output[key] = text(source[key], maximum);
    output.format = choice(source.format, FORMATS, 'Workshop');
    output.timezone = choice(source.timezone, TIMEZONES, 'Asia/Kuala_Lumpur');
    output.admission = choice(source.admission, ['free','paid'], 'free');
    output.paymentMethod = source.paymentMethod === '' && output.admission === 'free' ? '' : choice(source.paymentMethod, ['bank','organiser'], 'bank');
    for (const key of ['date','startsAt','endsAt','fee']) output[key] = text(source[key], 20);
    const images = source.images ?? [];
    if (!Array.isArray(images) || images.length > 3) fail('An event accepts at most three images.');
    output.images = images.map(id);
    if (new Set(output.images).size !== output.images.length) fail('An attachment cannot be repeated.');
    output.brochure = fileId(source.brochure);
    if (ready) {
      for (const key of ['title','summary','description','date','startsAt','endsAt','venue']) if (!output[key]) fail(`${key} is required before preview.`);
      output.date = date(output.date);
      for (const key of ['startsAt','endsAt']) if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(output[key] as string)) fail('Start and end times must use HH:mm.');
      if ((output.endsAt as string) <= (output.startsAt as string)) fail('End time must be after start time on the event date.');
      if (output.admission === 'paid') {
        const fee = output.fee as string;
        if (!/^\d+(?:\.\d{1,2})?$/u.test(fee) || Number(fee) < .01 || Number(fee) > 100000) fail('Fee must be RM 0.01 to RM 100,000 with at most two decimal places.');
        if (output.paymentMethod === 'bank' && ['bankName','accountName','accountNumber'].some(key => !output[key])) fail('Bank transfer details are required.');
        output.receiptEmail = email(output.receiptEmail);
      }
    }
    if (output.admission === 'free') for (const key of ['fee','paymentMethod','bankName','accountName','accountNumber','receiptEmail','paymentNotes']) output[key] = '';
    else if (output.paymentMethod !== 'bank') for (const key of ['bankName','accountName','accountNumber']) output[key] = '';
  } else if (type === 'discover') {
    for (const [key, maximum] of Object.entries({tag:80,title:140,description:700,imageAlt:180})) output[key] = text(source[key], maximum, ready);
    output.websiteUrl = source.websiteUrl ? httpsUrl(source.websiteUrl) : '';
    if (ready && !output.websiteUrl) fail('A complete HTTPS website address is required.');
    output.defaultImage = choice(source.defaultImage, DEFAULT_IMAGES, DEFAULT_IMAGES[0]!);
    output.image = fileId(source.image);
  } else {
    for (const [key, maximum] of Object.entries({title:160,subtitle:200,description:4000,author:140})) output[key] = text(source[key], maximum, ready && ['title','description'].includes(key));
    output.issueDate = source.issueDate ? date(source.issueDate) : '';
    output.cover = fileId(source.cover); output.pdf = fileId(source.pdf);
    if (ready && (!output.cover || !output.pdf)) fail('A cover image and PDF book are required before preview.');
  }
  return output;
}
export function attachmentIds(type: Kind, data: ContentData): {id:string;role:string}[] {
  if (type === 'event') return [...(data.images as string[]).map(value => ({id:value,role:'image'})), ...(data.brochure ? [{id:data.brochure as string,role:'brochure'}] : [])];
  if (type === 'discover') return data.image ? [{id:data.image as string,role:'image'}] : [];
  return ['cover','pdf'].filter(role => data[role]).map(role => ({id:data[role] as string,role}));
}
export function uploadLimit(type: Kind, role: string, mime: string): number {
  if (role === 'image' && type !== 'publication' || role === 'cover' && type === 'publication') {
    if (['image/jpeg','image/png','image/webp'].includes(mime)) return 5 * 1024 * 1024;
  }
  if (mime === 'application/pdf' && role === 'brochure' && type === 'event') return 10 * 1024 * 1024;
  if (mime === 'application/pdf' && role === 'pdf' && type === 'publication') return 25 * 1024 * 1024;
  return fail('Unsupported attachment type.');
}
export const CSV_HEADERS = ['name','email','member_reference','status'];
export interface RegistryRow { rowNumber:number; name:string; email:string; memberReference:string; status:string; action:'add'|'update'|'unchanged'|'invalid'; errors:string[]; accessSuspended?:boolean; restoreSuspension?:boolean }
export interface RegistryEntry {name:string;email:string;memberReference:string;status:string;accessSuspended:boolean}
export function parseRegistryCsv(raw: unknown): RegistryRow[] {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 2 * 1024 * 1024) fail('Choose a UTF-8 CSV no larger than 2 MiB.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(raw)) fail('The CSV contains unsupported control characters.');
  for (let index=0;index<raw.length;index++) {
    const code=raw.charCodeAt(index);
    if (code>=0xD800 && code<=0xDBFF) { const next=raw.charCodeAt(++index); if (!(next>=0xDC00 && next<=0xDFFF)) fail('The CSV must contain valid UTF-8 text.'); }
    else if (code>=0xDC00 && code<=0xDFFF) fail('The CSV must contain valid UTF-8 text.');
  }
  const input = raw.replace(/^\uFEFF/u, '');
  const table: string[][] = []; let record:string[] = [], field = '', quoted = false, closed = false;
  const pushField = () => { if (field.length > 2048) fail('CSV fields must be no longer than 2,048 characters.'); record.push(field); field = ''; closed = false; };
  const pushRow = () => { pushField(); table.push(record); record = []; if (table.length > 5001) fail('The CSV must contain no more than 5,000 membership rows.'); };
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') { if (input[i+1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += char;
    } else if (char === '"') {
      if (field || closed) fail('The CSV has invalid quoting.'); quoted = true;
    } else if (char === ',') pushField();
    else if (char === '\r' || char === '\n') { if (char === '\r' && input[i+1] === '\n') i++; pushRow(); }
    else { if (closed) fail('The CSV has text after a closing quote.'); field += char; }
    if (field.length > 2048) fail('CSV fields must be no longer than 2,048 characters.');
  }
  if (quoted) fail('The CSV has an unterminated quoted field.');
  if (field || record.length || closed) pushRow();
  if (JSON.stringify(table.shift()) !== JSON.stringify(CSV_HEADERS)) fail(`Use exactly these CSV headers, in order: ${CSV_HEADERS.join(',')}.`);
  if (!table.length) fail('The CSV must contain at least one membership row.');
  return table.map((values,index) => {
    if (values.length !== 4) fail(`CSV row ${index+2} must have exactly four columns.`);
    const [nameValue,emailValue,referenceValue,statusValue] = values.map(value => value.trim());
    return {rowNumber:index+2,name:nameValue!,email:emailValue!.toLowerCase(),memberReference:referenceValue!,status:statusValue!,action:'invalid',errors:[]};
  });
}
export function classifyRegistry(rows: RegistryRow[], existing: RegistryEntry[], accounts: Map<string, {uid:string;admin:boolean;membershipReference:string|null;unlinkedAuthOnly?:boolean;identityConflict?:boolean}>, restoreSuspended=false) {
  const byEmail = new Map(existing.map(row => [row.email,row])), byReference = new Map(existing.map(row => [row.memberReference,row]));
  const emails = new Map<string,number>(), references = new Map<string,number>();
  for (const row of rows) { emails.set(row.email,(emails.get(row.email)??0)+1); references.set(row.memberReference,(references.get(row.memberReference)??0)+1); }
  let duplicates=0;
  for (const row of rows) {
    const errors:string[] = [];
    if (!row.name || row.name.length >80) errors.push('Name is required and must be 80 characters or fewer.');
    try { email(row.email); } catch { errors.push('A valid email address of 160 characters or fewer is required.'); }
    if (!row.memberReference || row.memberReference.length >80) errors.push('Membership reference is required and must be 80 characters or fewer.');
    if (!['eligible','ineligible'].includes(row.status)) errors.push('Status must be eligible or ineligible.');
    if ([row.name,row.email,row.memberReference,row.status].some(value => /[\u0000-\u001f\u007f]/u.test(value))) errors.push('Fields must be on one line without control characters.');
    const duplicate = (emails.get(row.email)??0)>1 || (references.get(row.memberReference)??0)>1;
    if (duplicate) { errors.push('Email or membership reference is repeated in this CSV.'); duplicates++; }
    const emailEntry = byEmail.get(row.email), referenceEntry = byReference.get(row.memberReference);
    if (emailEntry && emailEntry.memberReference !== row.memberReference) errors.push('Email already belongs to a different membership reference.');
    if (referenceEntry && referenceEntry.email !== row.email) errors.push('Membership reference already belongs to a different email.');
    const account = accounts.get(row.email);
    if (account?.admin) errors.push('Administrator identities cannot be imported as members.');
    else if (account && (account.identityConflict===true || account.membershipReference !== row.memberReference && account.unlinkedAuthOnly!==true)) errors.push('Email or reference already belongs to a conflicting or unlinked account.');
    row.errors = errors;
    row.restoreSuspension = restoreSuspended && !errors.length && row.status === 'eligible' && referenceEntry?.accessSuspended === true;
    row.action = errors.length ? 'invalid' : !referenceEntry ? 'add' : row.restoreSuspension || ['name','email','memberReference','status'].some(key => row[key as keyof RegistryRow] !== referenceEntry[key as keyof RegistryEntry]) ? 'update' : 'unchanged';
    row.accessSuspended = !row.restoreSuspension && (referenceEntry?.accessSuspended === true || row.status === 'ineligible');
  }
  const errors = rows.flatMap(row => row.errors.map(error => `Row ${row.rowNumber}: ${error}`));
  return {errors,counts:{total:rows.length,add:rows.filter(row=>row.action==='add').length,update:rows.filter(row=>row.action==='update').length,unchanged:rows.filter(row=>row.action==='unchanged').length,invalid:rows.filter(row=>row.action==='invalid').length,errors:errors.length,omitted:existing.filter(row=>!references.has(row.memberReference)).length,duplicates,restoredSuspensions:rows.filter(row=>row.restoreSuspension).length}};
}



