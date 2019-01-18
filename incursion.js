"use strict";

const securityColors = Object.freeze(['#F00000', '#D73000', '#F04800', '#F06000', '#D77700', '#EFEF00', '#8FEF2F', '#00F000', '#00EF47', '#48F0C0', '#2FEFEF']);

const routePreferValues = Object.freeze(['secure', 'insecure', 'shortest']);

function fromEntries(iterable) {
    return [...iterable].reduce((obj, [key, value]) => Object.assign(obj, {[key]: value}), {});
}

function superCarrierIcon() {
    const icon = document.createElement('canvas');
    icon.width = 32;
    icon.height = 32;
    const ctx = icon.getContext('2d');
    ctx.scale(2, 2);
    ctx.translate(8, 8);
    ctx.rotate(45 * Math.PI / 180);
    ctx.translate(-8, -8);
    ctx.fillStyle = '#7d0808';
    ctx.fillRect(3,3,7,7);
    ctx.strokeStyle = '#d63333';
    ctx.strokeRect(3,3,7,7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, 4);
    ctx.lineTo(12, 12);
    ctx.lineTo(4, 12);
    ctx.stroke();
    return icon;
}

function securityStatus(value) {
    let security = document.createDocumentFragment();
    const span = document.createElement('span');
    span.appendChild(document.createTextNode(value.toFixed(1)));
    if (value < 0) {
        value = 0;
    }
    span.style.color = securityColors[Math.floor(value.toFixed(1) * 10)];

    security.appendChild(document.createTextNode('('));
    security.appendChild(span);
    security.appendChild(document.createTextNode(')'));
    return security;
}

function queryParams(params) {
    if (!params) {
        return '';
    }
    return '?' + Object.entries(params).map(
        ([key, value]) => {
            if (Array.isArray(value)) {
                return value.map(valueValue => `${key}=${valueValue}`);
            }
            return `${key}=${value}`;
        }
    ).flat(1).join('&');
}


async function esiFetch(endpoint, params={}) {
    if (!params.datasource) {
        params.datasource = 'tranquility';
    }
    const response = await fetch(`https://esi.evetech.net/latest/${endpoint}/${queryParams(params)}`);
    const data = await response.json();
    return data;
}

let routes = {};

async function getRoute() {
    let locationName = document.getElementById('location');
    window.localStorage.setItem('location', locationName.value || '');
    if (!locationName.value) {
        return;
    }

    let flag = routePreferValues[0];
    let prefer = document.getElementById('prefer');
    if (prefer && prefer.value && routePreferValues.indexOf(prefer.value) > -1) {
        flag = prefer.value;
        window.localStorage.setItem('prefer', prefer.value);
    }

    let avoidSystems = [];
    let avoid = document.getElementById('avoid');
    window.localStorage.setItem('avoid', avoid.value || '');
    if (avoid && avoid.value) {
        avoidSystems = avoid.value.split(',');
    }
    const avoidData = await Promise.all(avoidSystems.map(systemName => esiFetch('search', {categories: 'solar_system', search: systemName})));
    const avoidSystemIDs = avoidData.map(item => item.solar_system.length == 1 ? item.solar_system : null).flat();

    const {solar_system: [locationID]} = await esiFetch('search', {search: locationName.value, categories: 'solar_system'});
    if (!locationID) {
        alert('Unable to find solar system. Please try a more specific query.');
    }

    let routeData = fromEntries(await Promise.all(Object.entries(routes).map(async ([systemID, routeDiv]) => {
        let routePath = await esiFetch(`route/${locationID}/${systemID}`, {flag, avoid: avoidSystemIDs});
        return [systemID, routePath];
    })));

    let systems = fromEntries(await Promise.all(Object.values(routeData).flat().map(async systemID => [systemID, await esiFetch(`universe/systems/${systemID}`)])));

    Object.entries(routes).forEach(([systemID, oldDiv]) => {
        let path = routeData[systemID];
        let newDiv = document.createElement('div');
        let newOL = document.createElement('ol');
        newOL.style.display = 'none';

        let hopNumber = document.createElement('a');
        hopNumber.href = '#';
        hopNumber.addEventListener('click', (e) => {
            e.preventDefault();
            if (newOL.style.display == 'block') {
                newOL.style.display = 'none';
            } else {
                newOL.style.display = 'block';
            }
        });
        hopNumber.appendChild(document.createTextNode(`${path.length} jumps`));
        newDiv.appendChild(hopNumber);

        
        path.forEach(hopID => {
            let {name, security_status} = systems[hopID];
            const li = document.createElement('li');
            const systemName = document.createElement('a');
            systemName.href = `https://evemaps.dotlan.net/system/${name}`;
            systemName.appendChild(document.createTextNode(name));
            li.appendChild(systemName);
            li.appendChild(document.createTextNode(' '));
            li.appendChild(securityStatus(security_status));
            newOL.appendChild(li);
        });
        newDiv.appendChild(newOL);
        oldDiv.replaceWith(newDiv);
        routes[systemID] = newDiv;
    });
}

async function renderIncursions(incursionData) {
    let constellations = fromEntries(await Promise.all(incursionData.map(
        async ({constellation_id}) => [constellation_id, await esiFetch(`universe/constellations/${constellation_id}`)]
    )));
    
    let regions = fromEntries(await Promise.all(Object.values(constellations).map(
        async ({region_id}) => [region_id, await esiFetch(`universe/regions/${region_id}`)]
    )));

    let systems = fromEntries(await Promise.all(incursionData.map(
        ({infested_solar_systems}) => infested_solar_systems.map(
            async system => [system, await esiFetch(`universe/systems/${system}`)]
        )
    ).flat()));

    const gates = fromEntries(await Promise.all(Object.values(systems).map(
        ({stargates}) => stargates.map(
            async gate => [gate, await esiFetch(`universe/stargates/${gate}`)]
        )
    ).flat()));

    const allIncursions = document.createDocumentFragment();
    incursionData.sort((a, b) => {
        let aStaging = systems[a.staging_solar_system_id].security_status;
        let bStaging = systems[b.staging_solar_system_id].security_status;
        if (aStaging < bStaging) {
            return 1;
        } else if (aStaging > bStaging) {
            return -1;
        }
        return 0;
    });

    incursionData.forEach(incursion => {
        let incursionDisplay = document.createElement('main');
        const {constellation_id, infested_solar_systems} = incursion;
        const h1 = document.createElement('h1');
        const constellationLink = document.createElement('a');
        const regionName = regions[constellations[constellation_id].region_id].name.replace(' ', '_');
        const constellationName = constellations[constellation_id].name.replace(' ', '_');
        constellationLink.href = `https://evemaps.dotlan.net/map/${regionName}/${constellationName}`;
        constellationLink.appendChild(document.createTextNode(constellations[constellation_id].name));
        h1.appendChild(constellationLink);
        if (incursion.has_boss) {
            const icon = superCarrierIcon();
            icon.title = 'Boss spawned';
            icon.style.verticalAlign = 'bottom';
            icon.style.marginLeft = '0.25em';
            h1.appendChild(icon);
        }
        incursionDisplay.appendChild(h1);

        const state = document.createElement('div');
        const stateUpper = incursion.state.charAt(0).toUpperCase() + incursion.state.slice(1);
        state.appendChild(document.createTextNode(`State: ${stateUpper}`));
        incursionDisplay.appendChild(state);

        const influence = document.createElement('div');
        influence.appendChild(document.createTextNode(`Influence: ${((1 - incursion.influence) * 100).toFixed(1)}% effective`));
        incursionDisplay.appendChild(influence);

        const stagingSystem = systems[incursion.staging_solar_system_id];
        const stagingDisplay = document.createElement('div');
        stagingDisplay.appendChild(document.createTextNode(`Staging system: `));
        let stagingLink = document.createElement('a');
        stagingLink.href = `https://evemaps.dotlan.net/system/${stagingSystem.name}`;
        stagingLink.appendChild(document.createTextNode(stagingSystem.name));
        stagingDisplay.appendChild(stagingLink);
        stagingDisplay.appendChild(document.createTextNode(' '));
        stagingDisplay.appendChild(securityStatus(stagingSystem.security_status));
        incursionDisplay.appendChild(stagingDisplay);

        incursionDisplay.appendChild(document.createElement('h2').appendChild(document.createTextNode('Systems:')));
        const infestedSystems = document.createElement('ul');
        let unvisitedSystems = [incursion.staging_solar_system_id];
        const visitedSystems = new Set();
        let jumps = 0;
        let farthest = incursion.staging_solar_system_id;
        while (unvisitedSystems.length > 0) {
            let newUnvisited = [];
            unvisitedSystems.forEach(systemID => {
                if (!visitedSystems.has(systemID)) {
                    visitedSystems.add(systemID);
                    const system = systems[systemID];
                    const systemDisplay = document.createElement('li');
                    let systemName = document.createElement('a');
                    systemName.href = `https://evemaps.dotlan.net/system/${system.name}`;
                    systemName.appendChild(document.createTextNode(`${system.name}`));
                    systemDisplay.appendChild(systemName);
                    systemDisplay.appendChild(document.createTextNode(' '));
                    systemDisplay.appendChild(securityStatus(system.security_status));
                    if (jumps > 0) {
                        systemDisplay.appendChild(document.createTextNode(`{${jumps}}`));
                    }
                    infestedSystems.appendChild(systemDisplay);
                    newUnvisited = [...newUnvisited, ...system.stargates.map(gateID => gates[gateID].destination.system_id).filter(systemID => systems.hasOwnProperty(systemID))];
                    farthest = systemID;
                }
            })
            unvisitedSystems = newUnvisited;
            jumps++;
        }
        incursionDisplay.appendChild(infestedSystems);

        const route = document.createElement('div');
        route.appendChild(document.createElement('h2').appendChild(document.createTextNode('Route:')));
        const routeDiv = document.createElement('div');
        routes[farthest] = routeDiv;
        route.appendChild(routeDiv);
        incursionDisplay.appendChild(route);

        allIncursions.appendChild(incursionDisplay);
    });
    document.body.appendChild(allIncursions);
    getRoute();
}

async function main() {
    let location = window.localStorage.getItem('location');
    if (location) {
        document.getElementById('location').value = location;
    }
    let prefer = window.localStorage.getItem('prefer');
    if (prefer && ['secure', 'insecure', 'shortest'].indexOf(prefer) > -1) {
        document.getElementById('prefer').value = prefer;
    }
    let data = await esiFetch('incursions');
    renderIncursions(data);
    let routeForm = document.getElementById('routeForm');
    routeForm.addEventListener('submit', (e) => {e.preventDefault(); getRoute()});
}

(() => {
    let mainRan = false;
    if (document.readyState == 'loading') {
        document.addEventListener('readystatechange', () => {
            if (document.readyState != 'loading' && mainRan == false) {
                mainRan = true;
                main();
            }
        });
    } else {
        mainRan = true;
        main();
    }
})();