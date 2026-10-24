"""Run with sudo in the operator's terminal; never accepts database passwords."""
import datetime
import os
from pathlib import Path
import subprocess

def query(sql):
    return subprocess.check_output(
        ['/usr/sbin/runuser', '-u', 'postgres', '--', 'psql', '-X', '-v',
         'ON_ERROR_STOP=1', '-d', 'postgres', '-Atc', sql], text=True).strip()

if os.geteuid() != 0:
    raise SystemExit('Run this helper through sudo in your own terminal.')
path = Path(query('SHOW hba_file'))
if str(path) != '/var/lib/pgsql/data/pg_hba.conf' or path.is_symlink():
    raise SystemExit('Unexpected HBA path; no changes made.')
original = path.read_bytes()
print('Active HBA before editing:')
print(original.decode())
print('password_encryption:', query('SHOW password_encryption'))
role = query("SELECT rolcanlogin AND rolpassword LIKE 'SCRAM-SHA-256$%' AND (rolvaliduntil IS NULL OR rolvaliduntil > now()) FROM pg_authid WHERE rolname='trueda_tribe_id_app'")
if role != 't':
    raise SystemExit('App role lacks an unexpired SCRAM login credential. No HBA change made. Set its password privately with psql \\password under SET password_encryption=\'scram-sha-256\', then rerun.')
if query('SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL') != '0':
    raise SystemExit('Existing HBA parsing errors; no changes made.')
rule = b'host trueda_tribe_id trueda_tribe_id_app 127.0.0.1/32 scram-sha-256'
lines = original.splitlines(keepends=True)
matches = [i for i, line in enumerate(lines) if line.split(b'#', 1)[0].split()[:5] == [b'host', b'all', b'all', b'127.0.0.1/32', b'ident']]
if len(matches) != 1:
    raise SystemExit('Expected one generic IPv4 ident rule; no changes made.')
existing = [i for i, line in enumerate(lines) if line.split(b'#', 1)[0].split() == rule.split()]
if existing and (len(existing) != 1 or existing[0] >= matches[0]):
    raise SystemExit('Unexpected existing Trueda rule placement; no changes made.')
if not existing:
    backup = path.with_name(path.name + '.trueda-backup-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    subprocess.run(['cp', '--preserve=all', '--no-clobber', str(path), str(backup)], check=True)
    print('Preserved backup:', backup)
    lines.insert(matches[0], rule + b'\n')
    try:
        with path.open('wb') as handle:
            handle.write(b''.join(lines))
            handle.flush()
            os.fsync(handle.fileno())
        if query('SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL') != '0':
            raise RuntimeError('HBA parsing failed')
    except Exception:
        with path.open('wb') as handle:
            handle.write(original)
            handle.flush()
            os.fsync(handle.fileno())
        raise
if query('SELECT pg_reload_conf()') != 't':
    raise SystemExit('Reload request failed; backup retained.')
print(query('SELECT line_number,type,database,user_name,address,auth_method,error FROM pg_hba_file_rules'))
print('HBA parsed and reload requested. Direct TCP login must still verify authentication.')
