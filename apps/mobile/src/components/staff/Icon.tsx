import { Platform } from 'react-native';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  Boxes,
  Building2,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Cpu,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Inbox,
  Info,
  KeyRound,
  Leaf,
  LayoutGrid,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  NotebookPen,
  Package,
  PenLine,
  Phone,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  Share2,
  ShieldAlert,
  ShoppingBasket,
  Store,
  Sun,
  Truck,
  User,
  Warehouse,
  X,
  Zap,
  House,
  type LucideIcon,
} from 'lucide-react-native';

/** Decorative graphics: hidden from screen readers on every platform. */
export const decorative = (Platform.OS === 'web'
  ? { 'aria-hidden': true }
  : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' }) as object;

/**
 * One line-icon set (Lucide, the same family as the Web workspace) for both
 * apps. Names describe the meaning so screens never import Lucide directly.
 */
const ICONS = {
  home: House,
  building: Building2,
  box: Package,
  boxes: Boxes,
  warehouse: Warehouse,
  user: User,
  bell: Bell,
  scan: ScanLine,
  qr: QrCode,
  search: Search,
  back: ArrowLeft,
  close: X,
  chevron: ChevronRight,
  down: ChevronDown,
  share: Share2,
  phone: Phone,
  lock: KeyRound,
  mail: Mail,
  message: MessageSquare,
  eye: Eye,
  eyeOff: EyeOff,
  check: Check,
  alert: AlertTriangle,
  incident: ShieldAlert,
  info: Info,
  clock: Clock,
  journal: NotebookPen,
  tasks: ClipboardList,
  inbox: Inbox,
  truck: Truck,
  more: LayoutGrid,
  leaf: Leaf,
  basket: ShoppingBasket,
  store: Store,
  camera: Camera,
  pen: PenLine,
  flash: Zap,
  image: ImageIcon,
  sun: Sun,
  logout: LogOut,
  sync: RefreshCw,
  location: MapPin,
  device: Cpu,
  signal: Activity,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

type Props = { name: IconName; size?: number; color?: string; strokeWidth?: number };

export function Icon({ name, size = 22, color = '#1f2a37', strokeWidth = 2 }: Props) {
  const Glyph = ICONS[name];
  return <Glyph size={size} color={color} strokeWidth={strokeWidth} absoluteStrokeWidth={false} {...decorative} />;
}
