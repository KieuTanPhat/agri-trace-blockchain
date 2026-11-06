import type { IconName } from '../components/Icon';
import type { Tone } from '../theme/tokens';

/** Lot states in the wording of docs/core-business-rules.md. */
export const LOT_STATE: Record<string, { label: string; t: Tone }> = {
  HARVESTED: { label: 'Đã thu hoạch', t: 'green' },
  IN_TRANSPORT: { label: 'Đang vận chuyển', t: 'blue' },
  ARRIVED: { label: 'Đã đến nơi', t: 'blue' },
  RETAIL_RECEIVED: { label: 'Cửa hàng đã nhận', t: 'purple' },
  FOR_SALE: { label: 'Đang bán', t: 'blue' },
  SOLD: { label: 'Đã bán', t: 'purple' },
  RECALLED: { label: 'Đã thu hồi', t: 'red' },
  EXPIRED: { label: 'Hết hạn', t: 'red' },
  DAMAGED: { label: 'Hư hỏng', t: 'red' },
  REJECTED: { label: 'Bị từ chối', t: 'red' },
  CONSUMED: { label: 'Đã dùng để chế biến', t: 'orange' },
};

export const CYCLE_STATE: Record<string, { label: string; t: Tone }> = {
  CREATED: { label: 'Mới tạo', t: 'purple' },
  PLANTED: { label: 'Đã gieo trồng', t: 'blue' },
  GROWING: { label: 'Đang sinh trưởng', t: 'blue' },
  COMPLETED: { label: 'Đã kết thúc', t: 'green' },
  CANCELLED: { label: 'Đã hủy', t: 'red' },
};


export const ORG_TYPE: Record<string, { label: string; icon: IconName; t: Tone }> = {
  FARM: { label: 'Sản xuất (DN/HTX)', icon: 'leaf', t: 'green' },
  TRANSPORTER: { label: 'Vận chuyển', icon: 'truck', t: 'blue' },
  RETAILER: { label: 'Bán lẻ', icon: 'store', t: 'purple' },
  PROCESSOR: { label: 'Chế biến', icon: 'box', t: 'orange' },
  DISTRIBUTOR: { label: 'Phân phối', icon: 'truck', t: 'blue' },
};
