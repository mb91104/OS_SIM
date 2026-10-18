import { useUi } from "../state/useUi";

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div className="toast" key={t.id} data-tone={t.tone}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
