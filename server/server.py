import os
import uuid
import aiosqlite
from sanic import Sanic
from sanic.response import json

DB_FILE = os.environ.get('DB_FILE', 'incursion.db')
SANIC_PORT = int(os.environ.get('SANIC_PORT', 3000))
SANIC_HOST = os.environ.get('SANIC_HOST', '0.0.0.0')
SANIC_SOCKET = os.environ.get('SANIC_SOCKET', None)
SANIC_LOG = os.environ.get('SANIC_LOG', 'True') == 'True'
app = Sanic()

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

async def get_incursion_history():
    """Get timer information for incursions."""
    incursion_max = {'high': 1, 'low': 1, 'null': 3}
    incursion_count = incursion_max.copy()
    incursions = {'high': [], 'low': [], 'null': []}
    known_incursions = {}
    defeated_incursions = set()
    async with aiosqlite.connect(DB_FILE) as db:
        cursor = await db.execute(
            'select uuid, constellation_id, security, state, time from '
            'state_changes natural left join current_incursion '
            ' order by time desc;'
        )
        data = await cursor.fetchone()
        while not complete_history(incursion_count) and data:
            uuid, constellation_id, security, state, time = data
            if uuid not in known_incursions and all(data):
                known_incursions[uuid] = {
                    'constellation_id': constellation_id,
                    'time': time,
                    'security': security
                }
            if state == 'defeated':
                defeated_incursions.add(uuid)
            if state == 'established':
                established_incursion = known_incursions[uuid]
                established_security = established_incursion['security']
                if uuid in defeated_incursions:
                    incursions[established_security].append(
                        established_incursion
                    )
                elif len(incursions[established_security]) >= incursion_max[established_security]:
                    incursions[established_security].pop()
                incursion_count[established_security] -= 1
            data = await cursor.fetchone()
        return incursions
    
    

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
