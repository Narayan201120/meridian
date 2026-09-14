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
      {label ? <Text className="text-[13px] font-sans-medium text-graphite dark:text-nighttext ml-1">{label}</Text> : null}
      <TextInput
        placeholderTextColor="#7D7A70"
        className={cn(
          "bg-cardsurf dark:bg-nightcard border border-borderfaint dark:border-nightborder rounded-xl px-4 py-3 text-[15px] font-sans text-graphite dark:text-nighttext min-h-[44px] focus:border-primary",
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
