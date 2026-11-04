/** Templates are suggestions only. Assignment still validates capability,
 * supervisor authority, chain membership and the requested site scope. */
export const ENTERPRISE_ROLE_TEMPLATES = [
  { code: 'FARM_RECORDER', name: 'Nhân viên sản xuất', capability: 'FARM', permissions: ['profile.read','catalog.read','sites.read','production.read','production.write','trace.read','evidence.read','evidence.manage','materials.read','devices.read'] },
  { code: 'FARM_SUPERVISOR', name: 'Quản lý sản xuất', capability: 'FARM', permissions: ['profile.read','catalog.read','catalog.manage','sites.read','production.read','production.write','trace.read','reports.read','cases.read','cases.respond','evidence.read','evidence.manage','materials.read','materials.manage','devices.read','devices.manage'] },
  { code: 'DRIVER', name: 'Nhân viên vận chuyển', capability: 'TRANSPORTER', permissions: ['profile.read','sites.read','vehicles.read','distribution.read','distribution.write','distribution.sign','trace.read','cases.read','cases.respond','evidence.read','evidence.manage','devices.read'] },
  // A business that carries its own goods signs pickup and delivery through its driver, on the staff app.
  { code: 'FARM_DRIVER', name: 'Tài xế giao hàng', capability: 'FARM', permissions: ['profile.read','sites.read','vehicles.read','distribution.read','distribution.sign','trace.read','evidence.read','evidence.manage','devices.read'] },
  { code: 'DISTRIBUTOR_DRIVER', name: 'Tài xế giao hàng', capability: 'DISTRIBUTOR', permissions: ['profile.read','sites.read','vehicles.read','distribution.read','distribution.sign','trace.read','evidence.read','evidence.manage','devices.read'] },
  { code: 'PROCESSOR_DRIVER', name: 'Tài xế giao hàng', capability: 'PROCESSOR', permissions: ['profile.read','sites.read','vehicles.read','distribution.read','distribution.sign','trace.read','evidence.read','evidence.manage','devices.read'] },
  { code: 'RETAIL_DRIVER', name: 'Tài xế lấy hàng', capability: 'RETAILER', permissions: ['profile.read','sites.read','vehicles.read','distribution.read','distribution.sign','trace.read','evidence.read','evidence.manage','devices.read'] },
  { code: 'WAREHOUSE', name: 'Thủ kho phân phối', capability: 'DISTRIBUTOR', permissions: ['profile.read','catalog.read','sites.read','partners.read','distribution.read','distribution.write','distribution.sign','reports.read','inventory.manage','quarantine.manage','trace.read','evidence.read','evidence.manage','cases.read','cases.respond'] },
  { code: 'WAREHOUSE_QC', name: 'Kiểm soát chất lượng kho', capability: 'DISTRIBUTOR', permissions: ['profile.read','catalog.read','sites.read','distribution.read','reports.read','quarantine.manage','trace.read','evidence.read','evidence.manage','cases.read','cases.respond'] },
  { code: 'WAREHOUSE_MANAGER', name: 'Quản lý kho', capability: 'DISTRIBUTOR', permissions: ['profile.read','catalog.read','sites.read','partners.read','distribution.read','distribution.write','distribution.sign','reports.read','inventory.manage','quarantine.manage','quantity.adjust','trace.read','evidence.read','evidence.manage','cases.read','cases.respond'] },
  { code: 'RETAIL_RECEIVER', name: 'Nhân viên nhận hàng bán lẻ', capability: 'RETAILER', permissions: ['profile.read','catalog.read','sites.read','distribution.read','distribution.sign','reports.read','quarantine.manage','trace.read','evidence.read','evidence.manage','cases.read','cases.respond'] },
  { code: 'RETAIL_STOCK', name: 'Nhân viên bán lẻ và hao hụt', capability: 'RETAILER', permissions: ['profile.read','catalog.read','sites.read','reports.read','quantity.adjust','trace.read','cases.read'] },
  { code: 'PROCESSING_OPERATOR', name: 'Nhân viên chế biến', capability: 'PROCESSOR', permissions: ['profile.read','catalog.read','sites.read','processing.read','processing.write','trace.read','evidence.read','evidence.manage','cases.read'] },
  { code: 'PROCESSING_SUPERVISOR', name: 'Quản đốc chế biến', capability: 'PROCESSOR', permissions: ['profile.read','catalog.read','catalog.manage','sites.read','processing.read','processing.write','inventory.manage','quarantine.manage','reports.read','trace.read','evidence.read','evidence.manage','cases.read','cases.respond'] },
  { code: 'RAW_MATERIAL_KEEPER', name: 'Thủ kho nguyên liệu', capability: 'PROCESSOR', permissions: ['profile.read','catalog.read','sites.read','partners.read','distribution.read','distribution.write','distribution.sign','inventory.manage','quarantine.manage','processing.read','trace.read','evidence.read','evidence.manage','cases.read','cases.respond'] },
] as const;

export const organizationCode = (id: string) => `AGT-${id.replaceAll('-', '').toUpperCase()}`;
export function organizationIdFromCode(code: string) {
  const match = /^AGT-([A-F0-9]{8})([A-F0-9]{4})([A-F0-9]{4})([A-F0-9]{4})([A-F0-9]{12})$/i.exec(code);
  return match ? match.slice(1).join('-').toLowerCase() : null;
}
