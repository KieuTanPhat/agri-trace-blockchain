import { describe, it, expect } from 'vitest';
import { publicContact, publicProductDetails, visibleDirectoryImage } from './public-directory.presentation.js';

describe('Explicit public directory presentation', () => {
  it('keeps private profile/contact and catalog fields closed without publication', () => {
    const profile = { registrationData: {}, phone: 'PRIVATE_PHONE', address: 'PRIVATE_ADDRESS' };
    expect(publicContact(profile.registrationData)).toEqual({ published: false, phone: null, address: null, province: null, ward: null, website: null, introduction: null, logoEvidenceId: null });
    expect(publicProductDetails({price:'65000',storageConditions:'PRIVATE'},profile.registrationData).price).toBeNull();
  });
  it('only projects allowlisted fields from an explicit publication snapshot', () => {
    const registrationData = { publicDirectory: { published:true, catalogDetailsPublished:true, phone:'02873000001', address:'Đường số 1', province:'Lâm Đồng', logoEvidenceId:'8b777852-85ae-4cc2-9684-8c60965b1d53', privateKey:'NEVER', taxCode:'NEVER', website:'javascript:alert(1)' } };
    const contact=publicContact(registrationData);
    expect(contact.phone).toBe('02873000001');expect(contact.website).toBeNull();
    expect(JSON.stringify(contact)).not.toContain('NEVER');
    expect(publicProductDetails({price:'65000',category:'Trái cây tươi',gtin:null,storageConditions:'Giữ mát',ingredients:'100% trái cây',usageInstructions:'Rửa sạch'},registrationData)).toMatchObject({price:'65000',category:'Trái cây tươi',storageConditions:'Giữ mát'});
  });
  it('never returns a private replacement, withdrawn image, unrelated kind or document as a public image', () => {
    expect(visibleDirectoryImage([
      {id:'old',supersedesId:null,public:true,kind:'LOT_IMAGE',mediaType:'image/jpeg'},
      {id:'new',supersedesId:'old',public:false,kind:'LOT_IMAGE',mediaType:'image/jpeg'},
      {id:'document',supersedesId:null,public:true,kind:'LOT_DOCUMENT',mediaType:'image/jpeg'},
    ])).toBeNull();
    expect(visibleDirectoryImage([{id:'ok',supersedesId:null,public:true,kind:'LOT_IMAGE',mediaType:'image/jpeg'}])?.id).toBe('ok');
  });
});
