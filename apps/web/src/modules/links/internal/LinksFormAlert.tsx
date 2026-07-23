import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export type LinksFormAlertState = {
  open: boolean;
  title: string;
  description?: string;
  variant?: "success" | "error";
};

type Props = {
  alert: LinksFormAlertState;
  onClose: () => void;
};

export function LinksFormAlert({ alert, onClose }: Props) {
  if (!alert.open) return null;

  return (
    <Alert className="mb-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <AlertTitle>{alert.title}</AlertTitle>
          {alert.description && <AlertDescription>{alert.description}</AlertDescription>}
        </div>
        <button
          type="button"
          aria-label="Close alert"
          onClick={onClose}
          className="rounded px-2 py-1 text-sm hover:bg-muted"
        >
          Close
        </button>
      </div>
    </Alert>
  );
}
