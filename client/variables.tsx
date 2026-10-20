import { TextInput } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { fillTemplate, parseVariables } from "../shared/templates";
import { Button, Field, inputStyle, type Colors } from "./ui";

type Props = {
  content: string;
  colors: Colors;
  /** "Send" or "Copy"; the button also reads "<action> filled prompt" to screen readers. */
  action: "Send" | "Copy";
  busy?: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  cancelLabel?: string;
  /** Phones skip this so the keyboard does not cover the sheet as it opens. */
  autoFocus?: boolean;
  /**
   * Shows the title with the buttons above the fields. The composer popover keeps the height it had for
   * the results list, so buttons below the fields could start out of view.
   */
  title?: string;
};

/** Fields for each template variable, prefilled with its default. Submits the filled prompt text. */
export function VariableForm({ content, colors, action, busy, onSubmit, onCancel, cancelLabel = "Cancel", autoFocus = true, title }: Props) {
  const variables = useMemo(() => parseVariables(content), [content]);
  const [values, setValues] = useState(() => Object.fromEntries(variables.map((variable) => [variable.name, variable.fallback ?? ""])));
  // Only a variable without a default must have a value; clearing a default leaves it empty.
  const missing = variables.some((variable) => variable.fallback === undefined && !values[variable.name]?.trim());
  const submit = () => !missing && !busy && onSubmit(fillTemplate(content, values));
  const input = inputStyle(colors);
  const actions = (
    <>
      <Button title={cancelLabel} onPress={onCancel} colors={colors} disabled={busy} size={title ? "sm" : "md"} />
      <Button title={action} icon={action === "Send" ? "Send" : "Copy"} variant="primary" onPress={submit} colors={colors} disabled={busy || missing} size={title ? "sm" : "md"} accessibilityLabel={`${action} filled prompt`} />
    </>
  );
  return (
    <View style={{ gap: 12, minWidth: 0 }}>
      {title !== undefined && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", flex: 1, minWidth: 0 }}>{title}</Text>
          {actions}
        </View>
      )}
      {variables.map((variable, index) => (
        <Field key={variable.name} label={variable.name} hint={variable.fallback ? `Default: ${variable.fallback}` : undefined} colors={colors}>
          <TextInput
            accessibilityLabel={`Value for ${variable.name}`}
            value={values[variable.name]}
            onChangeText={(value) => setValues((current) => ({ ...current, [variable.name]: value }))}
            autoFocus={autoFocus && index === 0}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={index === variables.length - 1 ? submit : undefined}
            style={{ ...input, backgroundColor: colors.surface0, paddingVertical: 8, fontSize: 13 }}
          />
        </Field>
      ))}
      {missing && <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Fill in every field without a default.</Text>}
      {title === undefined && <View style={{ flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>{actions}</View>}
    </View>
  );
}
