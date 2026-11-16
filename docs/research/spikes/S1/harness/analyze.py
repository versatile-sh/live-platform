#!/usr/bin/env python3
"""Analyse one matrix case dir: removal latency seen by observers, duplicates, pid reuse."""
import json, sys, os, statistics as st

def load(p):
    out = []
    for l in open(p):
        try: out.append(json.loads(l))
        except Exception: pass
    return out

def rosters(path):
    r = [e for e in load(path) if e.get('k') == 'roster_rx']
    return [(e['ts'], e['msg']['rv'], e['msg']['roster']) for e in r]

def analyse(d):
    t0 = {}
    for f in os.listdir(d):
        if f.startswith('t0_'):
            name = f[3:-4]
            try: t0[name] = int(open(os.path.join(d, f)).readline().strip())
            except Exception: pass
    res = {'case': os.path.basename(d), 'n': len(t0)}
    obs = {o: rosters(os.path.join(d, o + '.jsonl')) for o in ('obs1', 'obs2')}
    dup = 0; reuse = 0; rvbad = 0
    for o, rs in obs.items():
        lastrv = 0; gone = set()
        for ts, rv, ro in rs:
            if rv <= lastrv: rvbad += 1
            lastrv = rv
            pids = [e['pid'] for e in ro]; names = [e['name'] for e in ro]
            if len(set(pids)) != len(pids) or len(set(names)) != len(names): dup += 1
            cur = set(pids)
            if gone & cur: reuse += 1
            # removal is terminal: anything seen before and now absent
            seen = globals().setdefault('_seen_' + o, set())
            gone |= (seen - cur); seen |= cur
        globals()['_seen_' + o] = set()
    res.update(duplicate_roster_versions=dup, pid_reappeared_after_removal=reuse, rv_not_increasing=rvbad)
    # per-target
    rows = {}
    for o, rs in obs.items():
        pidof = {}
        for ts, rv, ro in rs:
            for e in ro: pidof[e['name']] = e['pid']
        for name in sorted(t0):
            pid = pidof.get(name)
            first_present = None; susp = None; rem = None; last_state = None
            for ts, rv, ro in rs:
                ent = [e for e in ro if e['pid'] == pid]
                if ent:
                    first_present = first_present or ts; last_state = ent[0]['state']
                    if ent[0]['state'] == 'reconnecting' and susp is None and ts >= t0[name]: susp = ts
                elif first_present and rem is None and ts >= t0[name]:
                    rem = ts
            rows.setdefault(name, {})[o] = dict(pid=pid, suspect=None if susp is None else (susp - t0[name]) / 1e9,
                                                removed=None if rem is None else (rem - t0[name]) / 1e9, final=last_state)
    rem1 = [r['obs1']['removed'] for r in rows.values() if r['obs1']['removed'] is not None]
    rem2 = [r['obs2']['removed'] for r in rows.values() if r['obs2']['removed'] is not None]
    sus = [r['obs1']['suspect'] for r in rows.values() if r['obs1']['suspect'] is not None]
    finals = {}
    for r in rows.values(): finals[str(r['obs1']['final'])] = finals.get(str(r['obs1']['final']), 0) + 1
    def stats(x): return dict(n=len(x), min=round(min(x), 3), median=round(st.median(x), 3), max=round(max(x), 3)) if x else dict(n=0)
    res['removed_obs1'] = stats(rem1); res['removed_obs2'] = stats(rem2); res['suspect_obs1'] = stats(sus)
    res['final_state_obs1'] = finals
    res['observers_present_at_end'] = [o for o in obs if obs[o] and {e['name'] for e in obs[o][-1][2]} >= {o}]
    # server-side states and reasons
    sv = [e for e in load(os.path.join(d, 'server_all.jsonl')) if e.get('k') == 'state' and e.get('room') == res['case']]
    reasons = {}
    for e in sv:
        if e['to'] in ('reconnecting', 'removed'): reasons[e['to'] + ':' + e['why']] = reasons.get(e['to'] + ':' + e['why'], 0) + 1
    res['server_transitions'] = reasons
    return res

if __name__ == '__main__':
    for d in sys.argv[1:]:
        print(json.dumps(analyse(d)))
