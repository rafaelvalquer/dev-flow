import { toast } from "sonner";

export const notify = {
  success: (message, opts) => toast.success(message, opts),
  error: (message, opts) => toast.error(message, opts),
  warning: (message, opts) => toast.warning(message, opts),
  info: (message, opts) => toast.info(message, opts),

  loading: (message, opts) => toast.loading(message, opts),
  dismiss: (id) => toast.dismiss(id),
};
