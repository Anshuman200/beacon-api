import { toast as sonnerToast } from "sonner";

interface ToastOptions {
  description?: string;
  duration?: number;
}

/**
 * Centralized toast notifications for the whole app.
 * Wraps sonner so every feature calls the same small surface — swapping
 * the underlying toast library later only means editing this file.
 */
export const toast = {
  success: (message: string, options?: ToastOptions) => sonnerToast.success(message, options),
  error: (message: string, options?: ToastOptions) => sonnerToast.error(message, options),
  warning: (message: string, options?: ToastOptions) => sonnerToast.warning(message, options),
  info: (message: string, options?: ToastOptions) => sonnerToast.info(message, options),
  loading: (message: string, options?: ToastOptions) => sonnerToast.loading(message, options),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
};
