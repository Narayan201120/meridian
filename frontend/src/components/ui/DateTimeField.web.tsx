import { InputField } from "./InputField";

// Web fallback: plain text input (native picker lives in DateTimeField.tsx).
// Value is an ISO string (or "" when unset).
export function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  return (
    <InputField
      label={label}
      placeholder="YYYY-MM-DDTHH:MM"
      value={value}
      onChangeText={onChange}
      autoCapitalize="none"
    />
  );
}
