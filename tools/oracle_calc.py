#!/usr/bin/env python3
"""Independent reference values for test_calc.js, computed from the published
formulas in their ORIGINAL units (the Navy method's inch form, the ideal-weight
formulas in inches), so the JS centimetre forms are checked against a different
derivation rather than a transliteration of themselves."""
import json, math
IN = 2.54
out = {}
# Navy, inch form (Hodgdon & Beckett / DoD Instruction 1308.3)
def navy_m_in(h, neck, waist): return 86.010*math.log10(waist-neck) - 70.041*math.log10(h) + 36.76
def navy_f_in(h, neck, waist, hip): return 163.205*math.log10(waist+hip-neck) - 97.684*math.log10(h) - 78.387
cases = []
for h, n, w in [(70, 15, 34), (72, 16, 38), (68, 14.5, 31), (74, 17, 42)]:
    cases.append({'sex': 'm', 'h': h*IN, 'neck': n*IN, 'waist': w*IN, 'hip': 0, 'bf': navy_m_in(h, n, w)})
for h, n, w, hip in [(64, 13, 29, 38), (66, 13.5, 32, 40), (62, 12.5, 27, 36)]:
    cases.append({'sex': 'f', 'h': h*IN, 'neck': n*IN, 'waist': w*IN, 'hip': hip*IN, 'bf': navy_f_in(h, n, w, hip)})
out['navy'] = cases
# 1RM formulas, as published
w, r = 100.0, 5
out['onerm'] = {
  'epley': w*(1+r/30), 'brzycki': w*(36/(37-r)), 'lombardi': w*r**0.1, 'oconner': w*(1+r/40),
  'mayhew': 100*w/(52.2+41.9*math.exp(-0.055*r)), 'wathan': 100*w/(48.8+53.8*math.exp(-0.075*r)),
  'lander': 100*w/(101.3-2.67123*r),
}
# Ideal weight in inches over 5 ft
hin = 70
out['ideal_m_70in'] = {'devine': 50+2.3*10, 'robinson': 52+1.9*10, 'miller': 56.2+1.41*10, 'hamwi': 48+2.7*10, 'cm': hin*IN}
print(json.dumps(out, indent=1))
