import { Button, ToastTrigger } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";

// Close button for toasts so users can dismiss a notice immediately instead of
// waiting for it to time out. Pass to <ToastTitle action={<ToastDismissButton />}/>.
export function ToastDismissButton() {
  return (
    <ToastTrigger>
      <Button
        appearance="transparent"
        size="small"
        icon={<DismissRegular />}
        aria-label="Close"
      />
    </ToastTrigger>
  );
}
