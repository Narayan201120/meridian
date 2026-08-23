import { Text, TextInput, View } from "react-native";
import { cn } from "../../lib/cn";

export function InputField({
  label,
  error,
  className,
  inputClassName,
  ...props
}: {
  label?: string;
  error?: string;
  className?: string;
  inputClassName?: string;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View className={cn("gap-1.5", className)}>
      {label ? <Text className="text-[13px] font-semibold text-[#1A1A1A] ml-1">{label}</Text> : null}
      <TextInput
        placeholderTextColor="#7D7A70"
        className={cn(
          "bg-[#FFFDF8] border border-[#E2E8F0] rounded-xl px-4 py-3 text-[15px] text-[#1A1A1A] min-h-[44px] focus:border-[#09261E]",
          error && "border-red-300",
          inputClassName
        )}
        {...props}
      />
      {error ? <Text className="text-[12px] text-red-700 ml-1">{error}</Text> : null}
    </View>
  );
}

export function TextArea(props: React.ComponentProps<typeof TextInput> & { label?: string; error?: string }) {
  const { label, error, ...rest } = props as any;
  return (
    <InputField
      label={label}
      error={error}
      multiline
      className="gap-1.5"
      inputClassName="min-h-[108px] py-3"
      textAlignVertical="top"
      {...rest}
    />
  );
}
