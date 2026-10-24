import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action, Copy, ErrorState, LoadingState, StatePanel } from '../../components/UI';
import type { AuthService, DeviceView } from '../../api/auth-service';
import { ApiFailure } from '../../api/client';
import { AuthField } from './AuthField';
import { tokens } from '../../theme/tokens';
export function AccountSecurityScreen({ environmentLabel, auth, onBack, onSignedOut }: {
    environmentLabel?: string;
    auth: AuthService;
    onBack: () => void;
    onSignedOut: () => void;
}) {
    const [devices, setDevices] = useState<DeviceView[]>([]), [current, setCurrent] = useState(''), [statuses, setStatuses] = useState<{
        id: string;
        tribeName: string;
        status: string;
    }[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [password, setPassword] = useState(''), [next, setNext] = useState(''), [email, setEmail] = useState(''), [invitation, setInvitation] = useState(''), [name, setName] = useState('');
    const pending = useRef(false), alive = useRef(true);
    const load = useCallback(async () => {
        setBusy(true);
        setError('');
        try {
            const [sessions, memberships] = await Promise.all([auth.devices(), auth.memberships()]);
            if (alive.current) {
                setDevices(sessions.devices);
                setCurrent(sessions.currentSessionId);
                setStatuses(memberships.memberships);
            }
        }
        catch (error) {
            if (alive.current) {
                if (error instanceof ApiFailure && error.status === 401)
                    onSignedOut();
                else
                    setError(error instanceof Error ? error.message : 'Account unavailable.');
            }
        }
        finally {
            if (alive.current)
                setBusy(false);
        }
    }, [auth, onSignedOut]);
    useEffect(() => {
        alive.current = true;
        void load();
        return () => {
            alive.current = false;
        };
    }, [load]);
    useEffect(() => {
        const handler = BackHandler.addEventListener('hardwareBackPress', () => {
            if (!pending.current)
                onBack();
            return true;
        });
        return () => handler.remove();
    }, [onBack]);
    async function run(work: () => Promise<void>) {
        if (pending.current)
            return;
        pending.current = true;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await work();
        }
        catch (error) {
            if (error instanceof ApiFailure && error.status === 401)
                onSignedOut();
            else if (alive.current)
                setError(error instanceof Error ? error.message : 'Request failed.');
        }
        finally {
            pending.current = false;
            if (alive.current) {
                setBusy(false);
                setPassword('');
                setNext('');
            }
        }
    }
    return <SafeAreaView style={s.page}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}><Copy>Account security</Copy>{environmentLabel&&<Copy muted>{environmentLabel}</Copy>}{busy ? <LoadingState message="Loading account security…"/> : null}{error ? <ErrorState message={error} retry={() => void load()}/> : null}{notice ? <StatePanel message={notice}/> : null}<Copy>Membership status</Copy>{statuses.length ? statuses.map(item => <Copy key={item.id}>{item.tribeName}: {item.status}</Copy>) : <Copy>You have no Tribe memberships. An authorized invitation and activation are required.</Copy>}
 <Copy>Devices and sessions</Copy>{devices.map(device => <View key={device.id} style={s.card}><Copy>{device.deviceName}{device.id === current ? ' · current device' : ''}</Copy><Copy muted>Expires {new Date(device.expiresAt).toLocaleDateString()}</Copy>{!busy && <Action label={device.id === current ? 'Log out this device' : 'Revoke ' + device.deviceName} onPress={() => void run(async () => {
                    await auth.revokeDevice(device.id, device.id === current);
                    if (device.id === current)
                        onSignedOut();
                    else
                        await load();
                })}/>}</View>)}
 {!busy && <Action label="Log out all devices" onPress={() => void run(async () => {
        await auth.logoutAll();
        onSignedOut();
    })}/>}
 <Copy>Change password</Copy><AuthField label="Current password" secret value={password} onChange={setPassword} disabled={busy}/><AuthField label="New password (15–128 characters)" secret value={next} onChange={setNext} disabled={busy}/>{!busy && <Action label="Change password and end all sessions" onPress={() => void run(async () => {
        await auth.changePassword(password, next);
        onSignedOut();
    })}/>}
 <Copy>Change email</Copy><Copy muted>Your verified email stays unchanged until the new address is verified. Use your current password above to re-authenticate.</Copy><AuthField label="New email" email value={email} onChange={setEmail} disabled={busy}/>{!busy && <Action label="Verify new email" onPress={() => void run(async () => {
        await auth.changeEmail(password, email);
        setNotice('Check the new email for a verification token. Confirm it from the sign-in screen.');
    })}/>}
 <Copy>Accept another Tribe invitation</Copy><AuthField label="Invitation token" value={invitation} onChange={setInvitation} disabled={busy}/><AuthField label="Display name" value={name} onChange={setName} disabled={busy}/>{!busy && <Action label="Accept invitation" onPress={() => void run(async () => {
        await auth.acceptInvitation(invitation, name);
        setInvitation('');
        setNotice('Invitation accepted. Membership is pending verification and activation.');
        await load();
    })}/>}
 {!busy && <Action label="Back" onPress={onBack}/>}<Copy muted>This functional account-security layout requires later Figma refinement.</Copy></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
const s = StyleSheet.create({ page: { flex: 1, backgroundColor: tokens.colors.background }, content: { padding: 24, gap: 18, width: '100%', maxWidth: 560, alignSelf: 'center' }, card: { padding: 16, borderWidth: 1, borderColor: tokens.colors.subtleBorder, borderRadius: tokens.radius.card, gap: 8 } });
