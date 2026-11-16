import json,sys,re
for sc in sys.argv[1:]:
    d='logs/%s/'%sc
    s={}
    for l in open(d+'summary.txt'):
        if l.startswith(('cpu_start','cpu_end','wall')):
            k,v=l.split(':',1); s[k]=v.split()
    def cpu(x): return dict(zip(x[0::2],map(int,x[1::2])))
    c0,c1=cpu(s['cpu_start']),cpu(s['cpu_end']); w0,w1=map(float,s['wall'])
    wall=w1-w0
    series=[json.loads(l) for l in open(d+'stats_series.jsonl')]
    st0=json.load(open(d+'stats_start.json')); st1=json.load(open(d+'stats_end.json')); idle=json.load(open(d+'stats_idle.json'))
    dt=(st1['ts']-st0['ts'])/1e9
    load=[json.loads(l) for l in open(d+'load.log') if l.startswith('{')]
    # recv rate over the same window: find load samples bracketing st0 and st1
    def at(t):
        return min(load,key=lambda x:abs(x['ts']-t))
    a,b=at(st0['ts']),at(st1['ts'])
    rx=(b['recv']-a['recv'])/((b['ts']-a['ts'])/1e9)
    out=dict(scenario=sc,
      cpu_pct_of_one_core=round((c1['usage_usec']-c0['usage_usec'])/1e6/wall*100,1),
      throttled_periods=c1['nr_throttled']-c0['nr_throttled'], periods=c1['nr_periods']-c0['nr_periods'],
      throttled_ms=(c1['throttled_usec']-c0['throttled_usec'])/1000,
      window_s=round(wall,1),
      sfu_rtp_in_pps=round((st1['rtp_in']-st0['rtp_in'])/dt),
      sfu_rtp_out_expected_pps=round((st1['rtp_out_expected']-st0['rtp_out_expected'])/dt),
      client_recv_pps=round(rx),
      inbox_max=max(x['inbox_max'] for x in series+[st1]), inbox_full=st1['inbox_full'],
      pcs=st1['pcs'], rss_idle_kb=idle['rss_kb'], rss_load_kb=st1['rss_kb'], hwm_kb=st1['hwm_kb'],
      rss_per_pc_kb=round((st1['rss_kb']-idle['rss_kb'])/st1['pcs']), heap_mb=round(st1['heap_alloc']/1e6,1), goroutines=st1['goroutines'], gomaxprocs=st1['gomaxprocs'])
    out['delivery_ratio']=round(out['client_recv_pps']/max(1,out['sfu_rtp_out_expected_pps']),4)
    print(json.dumps(out))
