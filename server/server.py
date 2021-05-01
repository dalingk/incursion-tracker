import os
import uuid
import aiosqlite
from sanic import Sanic
from sanic.response import json
from pprint import pprint

DB_FILE = os.environ.get('DB_FILE', 'incursion.db')
SANIC_PORT = int(os.environ.get('SANIC_PORT', 3000))
SANIC_HOST = os.environ.get('SANIC_HOST', '0.0.0.0')
SANIC_SOCKET = os.environ.get('SANIC_SOCKET', None)
SANIC_LOG = os.environ.get('SANIC_LOG', 'True') == 'True'
app = Sanic(name='incursion')

async def get_incursion_data():
    """Parse incursions into a cohesive dictionary object."""
    incursions = {}
    async with aiosqlite.connect(DB_FILE) as db:
        cursor = await db.execute('SELECT current_incursion.uuid, constellation_id, current_incursion.state, has_boss, state_changes.state, state_changes.time FROM current_incursion join state_changes on state_changes.uuid = current_incursion.uuid where current_incursion.current = 1;')
        data = await cursor.fetchall()
        for x in data:
            if x[1] not in incursions:
                incursions[x[1]] = {'constellation_id': x[1], 'state': x[2], 'has_boss': bool(x[3]), 'history': {x[4]: x[5]}}
            else:
                incursions[x[1]]['history'][x[4]] = x[5]
    return incursions

def complete_history(incursion_history):
    """Return True if incursion history is complete."""
    return all(x <= 0 for x in incursion_history.values())

def post_process_incursions(
        incursions,
        known_incursions,
        defeated_incursions,
        incursion_max
    ):
    """Post process a list of incursion UUIDs, their information, and which 
    are defeated into the format needed for JSON."""
    out_incursions = {}
    for key, values in incursions.items():
        out_incursions[key] = [
            known_incursions[x] for x in values[:incursion_max[key]]
            if x in defeated_incursions
        ]
    return out_incursions

async def get_incursion_history():
    """Get timer information for incursions."""
    history = {'high': [], 'low': [], 'null': []}
    incursion_max = {'high': 1, 'low': 1, 'null': 3}
    async with aiosqlite.connect(DB_FILE) as db:
        cursor = await db.execute(
            'SELECT uuid, security from current_incursion where current = 1;'
        )
        for incursion_id, security in await cursor.fetchall():
            incursion_max[security] -= 1 if incursion_max[security] > 0 else 0

        cursor = await db.execute(
            'select uuid, constellation_id, security, state, time from '
            'state_changes natural left join current_incursion '
            'where state = "defeated" order by time desc;'
        )
        data = await cursor.fetchone()
        while not complete_history(incursion_max) and data:
            uuid, constellation_id, security, state, time = data
            if state == 'defeated' and incursion_max[security] > 0:
                history[security].append({
                    'constellation_id': constellation_id,
                    'time': time,
                    'security': security,
                    'history': {
                        'state': state,
                        'constellation_id': constellation_id,
                        'history': {
                            'defeated': time
                        }
                    }
                })
                incursion_max[security] -= 1
            data = await cursor.fetchone()
        return history
    
    

@app.route('/')
async def test(request):
    return json(await get_incursion_data())

@app.route('/timers')
async def get_timers(request):
    return json(await get_incursion_history())

if __name__ == '__main__':
    if SANIC_SOCKET:
        app.run(socket=SANIC_SOCKET, access_log=SANIC_LOG)
    else:
        app.run(host=SANIC_HOST, port=SANIC_PORT, access_log=SANIC_LOG)
