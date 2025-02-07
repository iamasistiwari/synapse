import { cva, VariantProps } from 'class-variance-authority';
import { ButtonHTMLAttributes, FC } from 'react';
import { cn } from '../lib/utils';
import { Loader2 } from 'lucide-react';

const buttonVariants = cva(
  'active:scale-95 inline-flex items-center justify-center rounded-lg text-sm transition-colors font-medium disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'text-white bg-[#9f5ebd] hover:opacity-75',
        ghost:
          'bg-neutral-50 dark:bg-neutral-800 text-black dark:text-white hover:opacity-75 border border-custom',
      },
      size: {
        default: 'py-3 px-7 h-11',
        lg: 'px-10 py-4 h-11 text-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonsProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  isLoading: boolean;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

const Button: FC<ButtonsProps> = ({
  className,
  children,
  variant,
  size,
  Icon,
  isLoading,
  ...props
}) => {
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
      disabled={isLoading}
    >
      {isLoading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Icon className="mr-2 h-4 w-4" />
      )}
      {children}
    </button>
  );
};
export default Button;
