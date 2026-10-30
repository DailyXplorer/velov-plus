import type { ReactElement } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon, AlertCircleIcon, ArrowDown01Icon, ArrowLeft02Icon, ArrowRight01Icon, ArrowRight02Icon,
  BatteryEmptyIcon as BatteryEmpty, BatteryFullIcon as BatteryFull, BatteryLowIcon as BatteryLow, BatteryMedium01Icon, BatteryMedium02Icon,
  BikeIcon, Cancel01Icon, ChartLineData02Icon, Clock01Icon, Coins01Icon, Copy01Icon, Download01Icon, FlashIcon, Home03Icon, Leaf01Icon, Loading03Icon, Location01Icon, Login01Icon, Logout05Icon,
  Mail01Icon, Navigation03Icon, ParkingAreaCircleIcon, PencilEdit02Icon, Refresh01Icon, Route01Icon, Search01Icon, SentIcon, SparkleIcon, SquareUnlock02Icon,
  StarHalfIcon as StarHalf, StarIcon as Star, ThumbsDownIcon as ThumbsDown, ThumbsUpIcon as ThumbsUp, Ticket01Icon, Tick02Icon,
  Timer02Icon, TrendingUpIcon, UserCircleIcon as UserCircle
} from "@hugeicons/core-free-icons";

type IconProps = {
  size?: number;
  weight?: "light" | "regular" | "bold" | "fill";
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
};

export type Icon = (props: IconProps) => ReactElement;

function hugeicon(icon: IconSvgElement): Icon {
  return ({ weight, ...props }) => <HugeiconsIcon icon={icon} strokeWidth={weight === "bold" ? 2 : 1.5} fill={weight === "fill" ? "currentColor" : "none"} {...props}/>;
}

const halfStar: IconSvgElement = [
  ...StarHalf.map(([tag, attrs]) => [tag, { ...attrs, fill: "none" }] as const),
  ["path", { key: "half", fill: "currentColor", d: "M11.9993 18.7917C11.4526 18.7917 10.9265 19.1026 9.87427 19.7244C8.08025 20.7845 6.94977 21.3578 6.45797 21.4824C6.40334 21.4962 6.34784 21.5 6.29148 21.5C5.70788 21.5 5.24716 21.0024 5.30793 20.4219C5.44314 19.1306 5.6265 17.9433 5.80612 16.9469C6.01661 15.7792 6.12186 15.1954 5.97471 14.7261C5.82756 14.2569 5.395 13.8249 4.52987 12.961C3.65132 12.0836 2.93633 11.2777 2.23944 10.5113C2.08729 10.344 2.00244 10.1262 2.00244 9.9001C2.00244 9.50036 2.265 9.15017 2.65328 9.05516C3.31945 8.89215 4.4796 8.63736 6.05284 8.40149C7.18801 8.2313 7.75559 8.14621 8.14498 7.86958C8.53437 7.59295 8.80577 7.07698 9.34859 6.04505C10.0521 4.70768 10.7445 3.57044 11.2026 2.90495C11.3825 2.64364 11.6827 2.5 11.9999 2.5Z" }]
];

export const ArrowClockwiseIcon = hugeicon(Refresh01Icon);
export const ArrowLeftIcon = hugeicon(ArrowLeft02Icon);
export const ArrowRightIcon = hugeicon(ArrowRight02Icon);
export const BatteryEmptyIcon = hugeicon(BatteryEmpty);
export const BatteryFullIcon = hugeicon(BatteryFull);
export const BatteryHighIcon = hugeicon(BatteryMedium02Icon);
export const BatteryLowIcon = hugeicon(BatteryLow);
export const BatteryMediumIcon = hugeicon(BatteryMedium01Icon);
export const BicycleIcon = hugeicon(BikeIcon);
export const CaretDownIcon = hugeicon(ArrowDown01Icon);
export const CaretRightIcon = hugeicon(ArrowRight01Icon);
export const ChartIcon = hugeicon(ChartLineData02Icon);
export const CheckIcon = hugeicon(Tick02Icon);
export const ClockIcon = hugeicon(Clock01Icon);
export const CoinsIcon = hugeicon(Coins01Icon);
export const CopyIcon = hugeicon(Copy01Icon);
export const DownloadSimpleIcon = hugeicon(Download01Icon);
export const EnvelopeSimpleIcon = hugeicon(Mail01Icon);
export const HouseIcon = hugeicon(Home03Icon);
export const LeafIcon = hugeicon(Leaf01Icon);
export const LetterCirclePIcon = hugeicon(ParkingAreaCircleIcon);
export const LightningIcon = hugeicon(FlashIcon);
export const LockOpenIcon = hugeicon(SquareUnlock02Icon);
export const MagnifyingGlassIcon = hugeicon(Search01Icon);
export const MapPinIcon = hugeicon(Location01Icon);
export const NavigationArrowIcon = hugeicon(Navigation03Icon);
export const PencilIcon = hugeicon(PencilEdit02Icon);
export const RouteIcon = hugeicon(Route01Icon);
export const SendIcon = hugeicon(SentIcon);
export const SignInIcon = hugeicon(Login01Icon);
export const SignOutIcon = hugeicon(Logout05Icon);
export const SpinnerGapIcon = hugeicon(Loading03Icon);
export const StarFourIcon = hugeicon(SparkleIcon);
export const StarHalfIcon = hugeicon(halfStar);
export const StarIcon = hugeicon(Star);
export const ThumbsDownIcon = hugeicon(ThumbsDown);
export const ThumbsUpIcon = hugeicon(ThumbsUp);
export const TicketIcon = hugeicon(Ticket01Icon);
export const TimerIcon = hugeicon(Timer02Icon);
export const TrendUpIcon = hugeicon(TrendingUpIcon);
export const UserCircleIcon = hugeicon(UserCircle);
export const WarningCircleIcon = hugeicon(AlertCircleIcon);
export const WarningIcon = hugeicon(Alert02Icon);
export const XIcon = hugeicon(Cancel01Icon);
