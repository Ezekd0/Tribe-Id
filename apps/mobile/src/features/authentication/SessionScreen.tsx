import { useEffect, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action, Copy, LoadingState, StatePanel } from '../../components/UI';
import { tokens } from '../../theme/tokens';
import type { AuthService, MfaChallenge } from '../../api/auth-service';
import { AuthField } from './AuthField';
type Mode = 'login' | 'enroll' | 'verify' | 'recover' | 'reset' | 'mfa' | 'email-confirm';
/** Functional provisional auth layout; final authentication Figma screens remain unavailable. */
export function SessionScreen({ environmentLabel, busy, message, retry, auth, onAuthenticated }: {
    environmentLabel?: string;
    busy: boolean;
    message: string;
    retry: () => void;
    auth?: AuthService;
    onAuthenticated?: () => void;
}) {
    const [mode, setMode] = useState<Mode>('login'), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [token, setToken] = useState(''), [name, setName] = useState(''), [code, setCode] = useState(''), [working, setWorking] = useState(false), [notice, setNotice] = useState(''), [challenge, setChallenge] = useState<MfaChallenge | null>(null), [secret, setSecret] = useState(''), [codes, setCodes] = useState<string[]>([]);
    const pending = useRef(false);
    function navigate(next: Mode) {
        setMode(next);
        setPassword('');
        setToken('');
        setCode('');
        setSecret('');
        setChallenge(null);
        setNotice('');
    }
    useEffect(() => {
        const handler = BackHandler.addEventListener('hardwareBackPress', () => {
            if (pending.current || codes.length)
                return true;
            if (mode !== 'login') {
                navigate('login');
                return true;
            }
            return false;
        });
        return () => handler.remove();
    }, [mode, codes.length]);
    async function run(work: () => Promise<void>) {
        if (pending.current)
            return;
        pending.current = true;
        setWorking(true);
        setNotice('');
        try {
            await work();
        }
        catch (error) {
            setNotice(error instanceof Error ? error.message : 'Unable to complete authentication.');
        }
        finally {
            pending.current = false;
            setWorking(false);
            setPassword('');
            setCode('');
        }
    }
    async function submit() {
        if (!auth)
            return;
        await run(async () => {
            switch (mode) {
                case 'login': {
                    const next = await auth.login(email, password);
                    if (next) {
                        setChallenge(next);
                        setMode('mfa');
                    }
                    else
                        onAuthenticated?.();
                    break;
                }
                case 'enroll':
                    await auth.enroll(token, password, name);
                    setMode('verify');
                    setToken('');
                    setNotice('Account created. Check your email for a verification token. Membership remains pending approval.');
                    break;
                case 'verify':
                    await auth.verify(token);
                    navigate('login');
                    setNotice('Email verified. You can sign in; membership activation is separate.');
                    break;
                case 'recover':
                    await auth.recover(email);
                    setMode('reset');
                    setNotice('If eligible, recovery instructions will be sent.');
                    break;
                case 'reset':
                    await auth.reset(token, password);
                    navigate('login');
                    setNotice('Password reset. Sign in again. Previous sessions have ended.');
                    break;
                case 'email-confirm':
                    await auth.confirmEmail(token);
                    navigate('login');
                    setNotice('New email verified. Sign in with your new email.');
                    break;
                case 'mfa':
                    if (challenge) {
                        const recovery = await auth.mfa(challenge.challengeToken, code);
                        setSecret('');
                        setChallenge(null);
                        if (recovery.length)
                            setCodes(recovery);
                        else
                            onAuthenticated?.();
                    }
                    break;
            }
        });
    }
    const disabled = working || busy;
    const labels: Record<Mode, string> = { login: 'Sign in', enroll: 'Accept invitation', verify: 'Verify email', recover: 'Recover password', reset: 'Set new password', mfa: 'Authenticator verification', 'email-confirm': 'Verify new email' };
    return <SafeAreaView style={s.page}><KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}><Text accessibilityRole="header" style={s.title}>Trueda Tribe ID</Text><Text style={s.label}>Member access</Text>{environmentLabel&&<Copy muted>{environmentLabel}</Copy>}{busy ? <LoadingState message="Restoring your secure session…"/> : codes.length ? <><Copy>Save these one-use recovery codes privately. They are shown only now. Recovery requires setting up a new authenticator.</Copy><Text selectable style={s.copy}>{codes.join('\n')}</Text><Action label="I have saved my recovery codes" onPress={() => {
            setCodes([]);
            onAuthenticated?.();
        }}/></> : <><Text accessibilityRole="header" style={s.title}>{labels[mode]}</Text><Copy>{message}</Copy>{notice ? <StatePanel message={notice}/> : null}{working ? <LoadingState message="Securing your account…"/> : null}
 {['login', 'recover'].includes(mode) && <AuthField label="Email" email value={email} onChange={setEmail} disabled={disabled}/>}
 {['enroll', 'verify', 'reset', 'email-confirm'].includes(mode) && <AuthField label={mode === 'enroll' ? 'Invitation token' : 'Email token'} value={token} onChange={setToken} disabled={disabled}/>}
 {mode === 'enroll' && <AuthField label="Display name" value={name} onChange={setName} disabled={disabled}/>}
 {['login', 'enroll', 'reset'].includes(mode) && <AuthField label={mode === 'login' ? 'Password' : 'New password (15–128 characters)'} secret value={password} onChange={setPassword} disabled={disabled}/>}
 {mode === 'mfa' && challenge && <>{challenge.enrollmentRequired && <><Copy>Administrator access requires an authenticator. Add this setup key to your authenticator app.</Copy>{secret ? <Text selectable style={s.copy}>{secret}</Text> : <Action label="Get authenticator setup key" onPress={() => void run(async () => {
            setSecret((await auth!.setup(challenge.challengeToken)).secret);
        })}/>}</>}<AuthField label="Authenticator code" value={code} onChange={setCode} disabled={disabled}/>{!challenge.enrollmentRequired && <><AuthField label="One-use recovery code" value={token} onChange={setToken} secret disabled={disabled}/><Action label="Recover authenticator" onPress={() => void run(async () => {
            setChallenge(await auth!.mfaRecover(challenge.challengeToken, token));
            setToken('');
            setSecret('');
        })}/></>}</>}
 {auth && !disabled && <Action label={labels[mode]} onPress={() => void submit()}/>}
 {!disabled && mode === 'login' && <><Action label="I have an invitation" onPress={() => navigate('enroll')}/><Action label="Verify email" onPress={() => navigate('verify')}/><Action label="Forgot password" onPress={() => navigate('recover')}/><Action label="Confirm email change" onPress={() => navigate('email-confirm')}/><Action label="Restore saved session" onPress={retry}/></>}
 {!disabled && mode === 'verify' && <><AuthField label="Email" email value={email} onChange={setEmail}/><Action label="Resend verification" onPress={() => void run(async () => {
            await auth?.resend(email);
            setNotice('If eligible, verification instructions will be sent.');
        })}/></>}
 {!disabled && mode !== 'login' && <Action label="Back to sign in" onPress={() => navigate('login')}/>}
 </>}<Text style={s.note}>This functional authentication layout uses the Tribe visual system and requires later Figma refinement.</Text></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
const s = StyleSheet.create({ page: { flex: 1, backgroundColor: tokens.colors.background }, flex: { flex: 1 }, content: { padding: 24, gap: 18, maxWidth: 560, width: '100%', alignSelf: 'center', paddingBottom: 40 }, title: { fontFamily: tokens.fonts.semibold, fontSize: 20, color: tokens.colors.foreground }, label: { fontFamily: tokens.fonts.body, color: tokens.colors.secondary, fontSize: 14, borderLeftWidth: 2, borderLeftColor: tokens.colors.accent, paddingLeft: 8 }, copy: { fontFamily: tokens.fonts.body, color: tokens.colors.foreground, fontSize: 14, lineHeight: 22 }, note: { fontFamily: tokens.fonts.body, color: tokens.colors.muted, fontSize: 11, lineHeight: 17 } });
