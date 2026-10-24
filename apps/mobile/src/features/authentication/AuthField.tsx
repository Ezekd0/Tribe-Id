import { StyleSheet, Text, TextInput, View } from 'react-native';
import { tokens } from '../../theme/tokens';
export function AuthField({ label, value, onChange, secret = false, email = false, disabled = false }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    secret?: boolean;
    email?: boolean;
    disabled?: boolean;
}) {
    return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} editable={!disabled} value={value} onChangeText={onChange} secureTextEntry={secret} autoCapitalize="none" autoCorrect={false} keyboardType={email ? 'email-address' : 'default'} textContentType={secret ? 'password' : email ? 'emailAddress' : 'none'} placeholderTextColor={tokens.colors.muted} style={s.input}/></View>;
}
const s = StyleSheet.create({ field: { gap: 8 }, label: { fontFamily: tokens.fonts.body, color: tokens.colors.secondary, fontSize: 13 }, input: { minHeight: 48, borderWidth: 1, borderColor: tokens.colors.subtleBorder, borderRadius: tokens.radius.card, padding: 12, color: tokens.colors.foreground, fontFamily: tokens.fonts.body, fontSize: 16, backgroundColor: tokens.colors.placeholder } });
