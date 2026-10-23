/**
 * Icons Component Collection - Clean Version
 * Only includes verified Lucide React icons
 */

import { 
  LucideProps,
  Activity,
  AlertCircle,
  ArrowRight,
  BarChart3,
  Bot,
  Brain,
  Code,
  Database,
  FileText,
  Github,
  Globe,
  Headphones,
  Home,
  Layers,
  Mail,
  MessageSquare,
  Monitor,
  Play,
  Settings,
  Users,
  Zap,
  Gamepad2,
  Headset
} from 'lucide-react';

// Export VrHeadset as an alias for Headset (closest available icon)
export const VrHeadset = Headset;

// Export all other icons
export {
  Activity,
  AlertCircle,
  ArrowRight,
  BarChart3,
  Bot,
  Brain,
  Code,
  Database,
  FileText,
  Github,
  Globe,
  Headphones,
  Headset,
  Home,
  Layers,
  Mail,
  MessageSquare,
  Monitor,
  Play,
  Settings,
  Users,
  Zap,
  Gamepad2
};

import {
  Loader2,
  Eye,
  EyeOff,
  Plus,
  Search,
  Grid as GridIcon,
  Globe as GlobeIcon,
  Smartphone,
  Brain as BrainIcon,
  BarChart,
  Building,
  MessageCircle,
  ShoppingCart,
  Clock,
  Download,
  Star,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ArrowRight as ArrowRightIcon,
  ArrowLeft,
  Menu,
  X,
  Settings as SettingsIcon,
  User,
  LogOut,
  Home as HomeIcon,
  Folder,
  FileText as FileTextIcon,
  Upload,
  Play,
  Pause,
  Square,
  RotateCcw,
  Copy,
  Edit,
  Trash,
  Save,
  Share,
  Filter,
  Calendar,
  Tag,
  Bell,
  Mail,
  Phone,
  MapPin,
  ExternalLink,
  GitBranch,
  Twitter,
  Linkedin,
  Facebook,
  Instagram,
  Youtube,
  Zap,
  Shield,
  Lock,
  Unlock,
  Key,
  Database,
  Server,
  Cloud,
  Monitor,
  Code,
  Terminal,
  Cpu,
  HardDrive,
  Wifi,
  WifiOff,
  Volume2,
  VolumeX,
  Camera,
  Image,
  Video,
  Mic,
  MicOff,
  Headphones,
  Speaker,
  Users,
  UserPlus,
  UserMinus,
  Heart,
  Bookmark,
  ThumbsUp,
  ThumbsDown,
  Flag,
  Paperclip,
  Info,
  AlertTriangle,
  CheckCircle,
  XCircle,
  HelpCircle,
  Package,
  Gift,
  CreditCard,
  DollarSign,
  MapPinned,
  Navigation,
  Compass,
  Route,
  Anchor,
  Plane,
  Car,
  Bike,
  Bus,
  Train,
  Ship,
  Rocket,
  Timer,
  Stopwatch,
  Hourglass,
  Watch,
  AlarmClock,
  CalendarDays,
  Workflow,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Bug,
  Wrench,
  Hammer,
  Scissors,
  Ruler,
  Pen,
  Pencil,
  Feather,
  Book,
  BookOpen,
  Library,
  GraduationCap,
  School,
  Palette,

  SortAsc,
  SortDesc
} from 'lucide-react';

export const Icons = {
  // Core UI
  spinner: Loader2,
  loader2: Loader2,
  eye: Eye,
  eyeOff: EyeOff,
  plus: Plus,
  search: Search,
  grid: Grid,
  globe: Globe,
  smartphone: Smartphone,
  brain: Brain,
  barChart: BarChart,
  building: Building,
  messageCircle: MessageCircle,
  shoppingCart: ShoppingCart,
  clock: Clock,
  download: Download,
  star: Star,
  check: Check,

  // Navigation
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronLeft: ChevronLeft,
  arrowRight: ArrowRight,
  arrowLeft: ArrowLeft,
  menu: Menu,
  x: X,

  // User Actions
  settings: Settings,
  user: User,
  logOut: LogOut,
  home: Home,
  folder: Folder,
  fileText: FileText,
  upload: Upload,

  // Media Controls
  play: Play,
  pause: Pause,
  stop: Square,
  refresh: RotateCcw,

  // Editing
  copy: Copy,
  edit: Edit,
  trash: Trash,
  save: Save,
  share: Share,

  // Data
  filter: Filter,
  sortAsc: SortAsc,
  sortDesc: SortDesc,
  calendar: Calendar,
  tag: Tag,

  // Communication
  bell: Bell,
  mail: Mail,
  phone: Phone,
  mapPin: MapPin,
  externalLink: ExternalLink,

  // Social/Tech
  github: GitBranch,
  twitter: Twitter,
  linkedin: Linkedin,
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,

  // Tech
  zap: Zap,
  shield: Shield,
  lock: Lock,
  unlock: Unlock,
  key: Key,
  database: Database,
  server: Server,
  cloud: Cloud,
  monitor: Monitor,
  code: Code,
  terminal: Terminal,
  cpu: Cpu,
  hardDrive: HardDrive,

  // Connectivity
  wifi: Wifi,
  wifiOff: WifiOff,

  // Audio/Video
  volume2: Volume2,
  volumeX: VolumeX,
  camera: Camera,
  image: Image,
  video: Video,
  mic: Mic,
  micOff: MicOff,
  headphones: Headphones,
  speaker: Speaker,

  // Users
  users: Users,
  userPlus: UserPlus,
  userMinus: UserMinus,

  // Interactions
  heart: Heart,
  bookmark: Bookmark,
  thumbsUp: ThumbsUp,
  thumbsDown: ThumbsDown,
  flag: Flag,
  paperclip: Paperclip,

  // Status
  info: Info,
  alertTriangle: AlertTriangle,
  checkCircle: CheckCircle,
  xCircle: XCircle,
  helpCircle: HelpCircle,

  // Commerce
  package: Package,
  gift: Gift,
  creditCard: CreditCard,
  dollarSign: DollarSign,

  // Location
  mapPinned: MapPinned,
  navigation: Navigation,
  compass: Compass,
  route: Route,
  anchor: Anchor,

  // Transport
  plane: Plane,
  car: Car,
  bike: Bike,
  bus: Bus,
  train: Train,
  ship: Ship,
  rocket: Rocket,

  // Time
  timer: Timer,
  stopwatch: Stopwatch,
  hourglass: Hourglass,
  watch: Watch,
  alarmClock: AlarmClock,
  calendarDays: CalendarDays,

  // Development
  workflow: Workflow,
  gitBranch: GitBranch,
  gitCommit: GitCommit,
  gitMerge: GitMerge,
  gitPullRequest: GitPullRequest,
  bug: Bug,

  // Tools
  wrench: Wrench,
  hammer: Hammer,
  scissors: Scissors,
  ruler: Ruler,
  pen: Pen,
  pencil: Pencil,
  feather: Feather,

  // Education
  book: Book,
  bookOpen: BookOpen,
  library: Library,
  graduationCap: GraduationCap,
  school: School,

  // Design
  palette: Palette,

  // Google icon for OAuth
  google: ({ className, ...props }: React.SVGProps<SVGSVGElement>) => (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...props}
    >
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M2.18 14.84c-.38-1.13-.58-2.33-.58-3.59s.2-2.46.58-3.59v-2.84H-.54C-1.96 7.04-2.68 9.53-2.68 12.25s.72 5.21 2.22 7.43l2.72-2.84z"
      />
      <path
        fill="currentColor"
        d="M12 4.75c1.92 0 3.63.66 4.97 1.95l3.73-3.73C18.47 1.08 15.47 0 12 0 7.7 0 3.99 2.47 2.18 6.16l2.72 2.84C5.71 6.41 8.71 4.75 12 4.75z"
      />
    </svg>
  ),
  // VR/AR icons for immersive experiences
  vr: ({ className, ...props }: React.SVGProps<SVGSVGElement>) => (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8z" />
      <path d="M7 16s0-2 3-2 3 2 3 2" />
      <path d="M14 16s0-2 3-2 3 2 3 2" />
    </svg>
  ),

  VrHeadset: ({ className, ...props }: React.SVGProps<SVGSVGElement>) => (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8z" />
      <path d="M7 16s0-2 3-2 3 2 3 2" />
      <path d="M14 16s0-2 3-2 3 2 3 2" />
    </svg>
  ),
};