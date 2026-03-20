import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// ==================== 太阳位置计算类 ====================
class SunPositionCalculator {
    constructor() {
        this.latitude = 40;
        this.longitude = 116;
    }

    degToRad(deg) {
        return deg * Math.PI / 180;
    }

    radToDeg(rad) {
        return rad * 180 / Math.PI;
    }

    getJulianDay(date) {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        
        let y = year;
        let m = month;
        if (m <= 2) {
            y -= 1;
            m += 12;
        }
        
        const A = Math.floor(y / 100);
        const B = 2 - A + Math.floor(A / 4);
        
        const jd = Math.floor(365.25 * (y + 4716)) + 
                   Math.floor(30.6001 * (m + 1)) + 
                   day + B - 1524.5;
        
        return jd;
    }

    calculateDeclination(jd) {
        const n = jd - 2451545.0;
        const L = 280.46 + 0.9856474 * n;
        const g = 357.528 + 0.9856003 * n;
        
        const lambda = L + 1.915 * Math.sin(this.degToRad(g)) + 
                      0.02 * Math.sin(this.degToRad(2 * g));
        
        const epsilon = 23.439 - 0.0000004 * n;
        
        const sinDecl = Math.sin(this.degToRad(epsilon)) * 
                        Math.sin(this.degToRad(lambda));
        
        return this.radToDeg(Math.asin(sinDecl));
    }

    calculateSunPosition(date, latitude, time) {
        const jd = this.getJulianDay(date);
        const declination = this.calculateDeclination(jd);
        
        // 时角计算
        const hourAngle = (time - 12) * 15;
        
        const latRad = this.degToRad(latitude);
        const decRad = this.degToRad(declination);
        const haRad = this.degToRad(hourAngle);
        
        // 高度角
        const sinAlt = Math.sin(latRad) * Math.sin(decRad) + 
                       Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
        const altitude = this.radToDeg(Math.asin(sinAlt));
        
        // 方位角
        let azimuth = 0;
        if (altitude > -90) {
            const cosAz = (Math.sin(decRad) - Math.sin(latRad) * sinAlt) / 
                          (Math.cos(latRad) * Math.cos(this.degToRad(altitude)));
            azimuth = this.radToDeg(Math.acos(Math.max(-1, Math.min(1, cosAz))));
            if (Math.sin(haRad) > 0) {
                azimuth = 360 - azimuth;
            }
        }
        
        return {
            altitude: altitude,
            azimuth: azimuth,
            declination: declination
        };
    }

    // 计算日出日落时间
    calculateSunriseSunset(date, latitude) {
        const jd = this.getJulianDay(date);
        const declination = this.calculateDeclination(jd);
        
        const latRad = this.degToRad(latitude);
        const decRad = this.degToRad(declination);
        
        // 计算日出日落时角
        const cosH = -Math.tan(latRad) * Math.tan(decRad);
        
        // 处理极昼极夜
        if (cosH <= -1) {
            return { sunrise: 0, sunset: 24, isPolarDay: true, isPolarNight: false };
        }
        if (cosH >= 1) {
            return { sunrise: null, sunset: null, isPolarDay: false, isPolarNight: true };
        }
        
        const H = this.radToDeg(Math.acos(cosH)) / 15;
        
        const sunrise = 12 - H;
        const sunset = 12 + H;
        
        return { sunrise, sunset, isPolarDay: false, isPolarNight: false };
    }

    calculateDayLength(date, latitude) {
        const { sunrise, sunset, isPolarDay, isPolarNight } = this.calculateSunriseSunset(date, latitude);
        if (isPolarNight) return 0;
        if (isPolarDay) return 24;
        return sunset - sunrise;
    }
}

// ==================== 3D场景管理类 ====================
class Sun3DVisualizer {
    constructor() {
        this.showAzimuthLabels = true;  // 修复1: 默认开启
        this.sunCalc = new SunPositionCalculator();
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null;
        this.controls = null;
        this.sunSphere = null;
        this.trajectoryLine = null;
        this.ground = null;
        this.pole = null;
        this.showTrajectory = true;      // 修复1: 默认开启
        this.animationId = null;
        this.clock = new THREE.Clock();
        this.azimuthTickLabels = [];
        this.directionLabels = [];
        this.isDragging = false;         // 用于拖动
        this.longPressTimer = null;
        
        this.init();
    }

    init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(-35, 8, 0);
        this.camera.lookAt(0, 0, 0);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.getElementById('canvas-container').appendChild(this.renderer.domElement);
        
        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.left = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        document.getElementById('canvas-container').appendChild(this.labelRenderer.domElement);
        
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.autoRotate = false;
        this.controls.enableZoom = true;
        this.controls.maxPolarAngle = Math.PI / 2;
        
        this.createSky();
        this.createGround();
        this.createCelestialSphere();
        this.createSun();
        this.createPole();
        this.createLights();
        
        // 收集所有方位相关的标签
        this.collectLabels();
        
        this.animate();
        
        window.addEventListener('resize', () => this.onWindowResize());
    }

    collectLabels() {
        // 这个方法会在创建标签时被调用，存储标签引用
    }

    createSky() {
        const cloudGeometry = new THREE.BufferGeometry();
        const cloudCount = 150;
        const cloudPositions = new Float32Array(cloudCount * 3);
        
        for (let i = 0; i < cloudCount; i++) {
            cloudPositions[i * 3] = (Math.random() - 0.5) * 60;
            cloudPositions[i * 3 + 1] = Math.random() * 15 + 5;
            cloudPositions[i * 3 + 2] = (Math.random() - 0.5) * 60;
        }
        
        cloudGeometry.setAttribute('position', new THREE.BufferAttribute(cloudPositions, 3));
        
        const cloudMaterial = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.6,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending
        });
        
        this.clouds = new THREE.Points(cloudGeometry, cloudMaterial);
        this.scene.add(this.clouds);
        
        const starsGeometry = new THREE.BufferGeometry();
        const starsCount = 2500;
        const starsPositions = new Float32Array(starsCount * 3);
        
        for (let i = 0; i < starsCount; i++) {
            const radius = 80;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            
            starsPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
            starsPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            starsPositions[i * 3 + 2] = radius * Math.cos(phi);
        }
        
        starsGeometry.setAttribute('position', new THREE.BufferAttribute(starsPositions, 3));
        
        const starsMaterial = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.3,
            transparent: true,
            opacity: 0
        });
        
        this.stars = new THREE.Points(starsGeometry, starsMaterial);
        this.scene.add(this.stars);
    }

    createGround() {
        const groundRadius = 15;
        const groundGeometry = new THREE.CircleGeometry(groundRadius, 64);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x96C78C,
            roughness: 0.99,
            metalness: 0.01
        });
        this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.y = 0;
        this.ground.receiveShadow = true;
        this.scene.add(this.ground);
        
        const lineMaterial = new THREE.LineBasicMaterial({ 
            color: 0xffffff, 
            linewidth: 2,
            transparent: true,
            opacity: 0.3 
        });
        const crossLength = groundRadius;
        
        const eastWestPoints = [
            new THREE.Vector3(-crossLength, 0.02, 0),
            new THREE.Vector3(crossLength, 0.02, 0)
        ];
        const eastWestGeo = new THREE.BufferGeometry().setFromPoints(eastWestPoints);
        const eastWestLine = new THREE.Line(eastWestGeo, lineMaterial);
        this.scene.add(eastWestLine);
        
        const northSouthPoints = [
            new THREE.Vector3(0, 0.02, -crossLength),
            new THREE.Vector3(0, 0.02, crossLength)
        ];
        const northSouthGeo = new THREE.BufferGeometry().setFromPoints(northSouthPoints);
        const northSouthLine = new THREE.Line(northSouthGeo, lineMaterial);
        this.scene.add(northSouthLine);
        
        const centerSphereGeo = new THREE.SphereGeometry(0.15, 16);
        const centerSphereMat = new THREE.MeshStandardMaterial({ color: 0xffaa44 });
        const centerSphere = new THREE.Mesh(centerSphereGeo, centerSphereMat);
        centerSphere.position.set(0, 0.05, 0);
        this.scene.add(centerSphere);
        
        const tickMaterial = new THREE.LineBasicMaterial({ color: 0x88aaff });
        
        for (let angle = 0; angle < 360; angle += 30) {
            const rad = this.sunCalc.degToRad(angle);
            const x1 = (crossLength - 0.8) * Math.sin(rad);
            const z1 = (crossLength - 0.8) * Math.cos(rad);
            const x2 = (crossLength - 0.3) * Math.sin(rad);
            const z2 = (crossLength - 0.3) * Math.cos(rad);
            
            const tickPoints = [
                new THREE.Vector3(x1, 0.02, -z1),
                new THREE.Vector3(x2, 0.02, -z2)
            ];
            const tickGeo = new THREE.BufferGeometry().setFromPoints(tickPoints);
            const tickLine = new THREE.Line(tickGeo, tickMaterial);
            this.scene.add(tickLine);
            
            if (angle % 30 === 0) {
                const div = document.createElement('div');
                div.textContent = angle + '°';
                div.style.color = '#aaccff';
                div.style.fontSize = '14px';
                div.style.fontWeight = 'bold';
                div.style.textShadow = '1px 1px 2px black';
                div.style.backgroundColor = 'rgba(0,0,0,0.3)';
                div.style.padding = '2px 4px';
                div.style.borderRadius = '2px';
                
                const label = new CSS2DObject(div);
                const labelX = (crossLength + 0.5) * Math.sin(rad);
                const labelZ = (crossLength + 0.5) * Math.cos(rad);
                label.position.set(labelX, 0, -labelZ);
                this.scene.add(label);
                this.azimuthTickLabels.push(label);
            }
        }
        
        const directions = [
            { text: '北 (N)', pos: [0, 0.1, -crossLength-2.5] },
            { text: '南 (S)', pos: [0, 0.1, crossLength+2.5] },
            { text: '东 (E)', pos: [crossLength+2.5, 0.1, 0] },
            { text: '西 (W)', pos: [-crossLength-2.5, 0.1, 0] }
        ];
        
        directions.forEach(dir => {
            const div = document.createElement('div');
            div.textContent = dir.text;
            div.style.color = '#fff';
            div.style.fontSize = '20px';
            div.style.fontWeight = 'bold';
            div.style.textShadow = '2px 2px 4px black';
            div.style.backgroundColor = 'rgba(0,0,0,0.4)';
            div.style.padding = '3px 6px';
            div.style.borderRadius = '8px';
            div.style.border = '2px solid rgba(255,255,255,0.5)';
            
            const label = new CSS2DObject(div);
            label.position.set(dir.pos[0], 0, dir.pos[2]);
            this.scene.add(label);
            this.directionLabels.push(label);
        });
        
        // 默认显示标签
        this.toggleAzimuthLabels(true);
    }

    createCelestialSphere() {
        const sphereRadius = 15;
        
        for (let lat = -80; lat <= 80; lat += 20) {
            const points = [];
            const radius = sphereRadius * Math.cos(this.sunCalc.degToRad(lat));
            const y = sphereRadius * Math.sin(this.sunCalc.degToRad(lat));
            
            for (let lon = 0; lon <= 360; lon += 10) {
                const x = radius * Math.sin(this.sunCalc.degToRad(lon));
                const z = radius * Math.cos(this.sunCalc.degToRad(lon));
                points.push(new THREE.Vector3(x, y, -z));
            }
            
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({ 
                color: 0x4488cc,
                transparent: true, 
                opacity: 0.35 
            });
            const line = new THREE.LineLoop(geometry, material);
            this.scene.add(line);
        }
        
        for (let lon = 0; lon < 360; lon += 30) {
            const points = [];
            for (let lat = -90; lat <= 90; lat += 5) {
                const x = sphereRadius * Math.cos(this.sunCalc.degToRad(lat)) * Math.sin(this.sunCalc.degToRad(lon));
                const y = sphereRadius * Math.sin(this.sunCalc.degToRad(lat));
                const z = sphereRadius * Math.cos(this.sunCalc.degToRad(lat)) * Math.cos(this.sunCalc.degToRad(lon));
                points.push(new THREE.Vector3(x, y, -z));
            }
            
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({ 
                color: 0x4488cc,
                transparent: true, 
                opacity: 0.35 
            });
            const line = new THREE.Line(geometry, material);
            this.scene.add(line);
        }
        
        const equatorPoints = [];
        for (let lon = 0; lon <= 360; lon += 5) {
            const x = sphereRadius * Math.sin(this.sunCalc.degToRad(lon));
            const z = sphereRadius * Math.cos(this.sunCalc.degToRad(lon));
            equatorPoints.push(new THREE.Vector3(x, 0, -z));
        }
        const equatorGeo = new THREE.BufferGeometry().setFromPoints(equatorPoints);
        const equatorMat = new THREE.LineBasicMaterial({ color: 0xffaa44 });
        const equator = new THREE.LineLoop(equatorGeo, equatorMat);
        this.scene.add(equator);
        
        const horizonPoints = [];
        for (let lon = 0; lon <= 360; lon += 5) {
            const x = sphereRadius * Math.sin(this.sunCalc.degToRad(lon));
            const z = sphereRadius * Math.cos(this.sunCalc.degToRad(lon));
            horizonPoints.push(new THREE.Vector3(x, 0, -z));
        }
        const horizonGeo = new THREE.BufferGeometry().setFromPoints(horizonPoints);
        const horizonMat = new THREE.LineBasicMaterial({ color: 0x88aaff, transparent: true, opacity: 0.2 });
        const horizon = new THREE.LineLoop(horizonGeo, horizonMat);
        this.scene.add(horizon);
    }

    createSun() {
        const geometry = new THREE.SphereGeometry(1.2, 32, 32);
        const material = new THREE.MeshStandardMaterial({
            color: 0xffdd44,
            emissive: 0xff4400,
            roughness: 0.2,
            metalness: 0.1
        });
        this.sunSphere = new THREE.Mesh(geometry, material);
        this.sunSphere.castShadow = false;
        this.sunSphere.receiveShadow = false;
        this.scene.add(this.sunSphere);
        
        const glowGeometry = new THREE.SphereGeometry(1.5, 16, 16);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: 0xffaa33,
            transparent: true,
            opacity: 0.3,
            side: THREE.BackSide
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        this.sunSphere.add(glow);
        
        const glow2Geometry = new THREE.SphereGeometry(1.8, 16, 16);
        const glow2Material = new THREE.MeshBasicMaterial({
            color: 0xff8833,
            transparent: true,
            opacity: 0.15,
            side: THREE.BackSide
        });
        const glow2 = new THREE.Mesh(glow2Geometry, glow2Material);
        this.sunSphere.add(glow2);
        
        const sunLight = new THREE.PointLight(0xffaa66, 0.2, 40);
        this.sunSphere.add(sunLight);
    }

    createPole() {
        const poleGroup = new THREE.Group();
        
        const poleGeo = new THREE.CylinderGeometry(0.15, 0.2, 2.8, 8);
        const poleMat = new THREE.MeshStandardMaterial({
            color: 0xcc9966,
            roughness: 0.6,
            metalness: 0.2
        });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 1.4;
        pole.castShadow = true;
        pole.receiveShadow = false;
        poleGroup.add(pole);
        
        const baseGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 8);
        const baseMat = new THREE.MeshStandardMaterial({ 
            color: 0x886644,
            roughness: 0.7
        });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 0.1;
        base.receiveShadow = true;
        base.castShadow = false;
        poleGroup.add(base);
        
        const topGeo = new THREE.SphereGeometry(0.2, 8);
        const topMat = new THREE.MeshStandardMaterial({ 
            color: 0xffaa44,
            emissive: 0x331100
        });
        const top = new THREE.Mesh(topGeo, topMat);
        top.position.y = 2.8;
        top.castShadow = true;
        poleGroup.add(top);
        
        poleGroup.position.set(0, 0, 0);
        
        this.pole = poleGroup;
        this.scene.add(this.pole);
    }

    createLights() {
        this.ambientLight = new THREE.AmbientLight(0x404060, 0.5);
        this.scene.add(this.ambientLight);
        
        this.sunLight = new THREE.DirectionalLight(0xffeedd, 1.2);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.width = 1024;
        this.sunLight.shadow.mapSize.height = 1024;
        this.sunLight.shadow.camera.near = 1;
        this.sunLight.shadow.camera.far = 30;
        this.sunLight.shadow.camera.left = -15;
        this.sunLight.shadow.camera.right = 15;
        this.sunLight.shadow.camera.top = 15;
        this.sunLight.shadow.camera.bottom = -15;
        this.scene.add(this.sunLight);
        
        this.fillLight = new THREE.PointLight(0x446688, 0.3);
        this.fillLight.position.set(-5, 5, 5);
        this.scene.add(this.fillLight);
    }

    createTrajectory(date, latitude) {
        if (this.trajectoryLine) {
            this.scene.remove(this.trajectoryLine);
        }
        
        if (!this.showTrajectory) return;
        
        const points = [];
        const sphereRadius = 15;
        
        const { isPolarDay, isPolarNight } = this.sunCalc.calculateSunriseSunset(date, latitude);
        
        for (let hour = 0; hour <= 24; hour += 0.2) {
            const sunPos = this.sunCalc.calculateSunPosition(date, latitude, hour);
            
            const altRad = this.sunCalc.degToRad(sunPos.altitude);
            const azRad = this.sunCalc.degToRad(sunPos.azimuth);
            
            const r = sphereRadius * Math.cos(altRad);
            const x = r * Math.sin(azRad);
            const z = -r * Math.cos(azRad);
            const y = sphereRadius * Math.sin(altRad);
            
            points.push(new THREE.Vector3(x, y, z));
        }
        
        if (points.length > 1) {
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            
            let material;
            if (isPolarNight) {
                material = new THREE.LineBasicMaterial({ 
                    color: 0x88aaff,
                    transparent: true,
                    opacity: 0.3
                });
            } else if (isPolarDay) {
                material = new THREE.LineBasicMaterial({ 
                    color: 0xffaa44,
                    linewidth: 2
                });
            } else {
                const colors = [];
                for (let i = 0; i < points.length; i++) {
                    const hour = i * 24 / points.length;
                    const sunPos = this.sunCalc.calculateSunPosition(date, latitude, hour);
                    
                    let color;
                    if (sunPos.altitude > 0) {
                        const t = sunPos.altitude / 90;
                        color = new THREE.Color().lerpColors(
                            new THREE.Color(0xffaa00),
                            new THREE.Color(0xffff00),
                            t
                        );
                    } else {
                        const t = Math.min(1, Math.abs(sunPos.altitude) / 90);
                        color = new THREE.Color().lerpColors(
                            new THREE.Color(0x3366cc),
                            new THREE.Color(0x88aaff),
                            t
                        );
                    }
                    colors.push(color.r, color.g, color.b);
                }
                geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
                material = new THREE.LineBasicMaterial({ vertexColors: true });
            }
            
            this.trajectoryLine = new THREE.Line(geometry, material);
            this.scene.add(this.trajectoryLine);
        }
    }

    updateBackground(altitude) {
        let color;

        if (altitude > 25) {
            color = new THREE.Color("#8DCED5");
        } else if (altitude > 15) {
            const t = (altitude - 15) / 10;
            color = new THREE.Color().lerpColors(
                new THREE.Color("#C1DBE9"),
                new THREE.Color("#8DCED5"),
                t
            );
        } else if (altitude > 5) {
            const t = (altitude - 5) / 10;
            color = new THREE.Color().lerpColors(
                new THREE.Color("#FEE3D7"),
                new THREE.Color("#C1DBE9"),
                t
            );
        } else if (altitude > 0) {
            const t = altitude / 5;
            color = new THREE.Color().lerpColors(
                new THREE.Color("#EB9347"),
                new THREE.Color("#FEE3D7"),
                t
            );
        } else if (altitude > -3) {
            const t = (altitude + 3) / 3;
            color = new THREE.Color().lerpColors(
                new THREE.Color("#FEAC63"),
                new THREE.Color("#EB9347"),
                t
            );
        } else if (altitude > -6) {
            const t = (altitude + 6) / 3;
            color = new THREE.Color().lerpColors(
                new THREE.Color("#CDA492"),
                new THREE.Color("#FEAC63"),
                t
            );
        } else if (altitude > -10) {
            const t = (altitude + 10) / 4;
            color = new THREE.Color().lerpColors(
                new THREE.Color("#3F4F6F"),
                new THREE.Color("#CDA492"),
                t
            );
        } else if (altitude > -18) {
            const t = (altitude + 18) / 8;
            color = new THREE.Color().lerpColors(
                new THREE.Color("#20263B"),
                new THREE.Color("#3F4F6F"),
                t
            );
        } else {
            color = new THREE.Color("#20263B");
        }
        
        this.scene.background = color;
        
        if (this.stars) {
            if (altitude < -4) {
                const opacity = Math.min(0.8, ( -altitude - 4 ) / 20);
                this.stars.material.opacity = opacity;
                this.stars.visible = true;
            } else if (altitude < 2) {
                const opacity = Math.max(0, 0.3 * (1 - (altitude + 4) / 6));
                this.stars.material.opacity = opacity;
                this.stars.visible = opacity > 0.05;
            } else {
                this.stars.visible = false;
            }
        }
        
        if (this.clouds) {
            this.clouds.visible = false;
        }
    }

    updateSunPosition(date, latitude, time) {
        const sunPos = this.sunCalc.calculateSunPosition(date, latitude, time);
        
        this.updateBackground(sunPos.altitude);
        
        document.getElementById('altitude').textContent = sunPos.altitude.toFixed(1);
        document.getElementById('azimuth').textContent = sunPos.azimuth.toFixed(1);
                   
        const dayLength = this.sunCalc.calculateDayLength(date, latitude);
        const hours = Math.floor(dayLength);
        const minutes = Math.floor((dayLength - hours) * 60);
        document.getElementById('day-length').textContent = `${hours}小时${minutes}分`;
        
        const { sunrise, sunset, isPolarDay, isPolarNight } = this.sunCalc.calculateSunriseSunset(date, latitude);
        
        if (isPolarDay) {
            document.getElementById('sunrise-time').textContent = '极昼';
            document.getElementById('sunset-time').textContent = '极昼';
        } else if (isPolarNight) {
            document.getElementById('sunrise-time').textContent = '极夜';
            document.getElementById('sunset-time').textContent = '极夜';
        } else if (sunrise !== null) {
            const sunriseHour = Math.floor(sunrise);
            const sunriseMin = Math.floor((sunrise - sunriseHour) * 60);
            const sunsetHour = Math.floor(sunset);
            const sunsetMin = Math.floor((sunset - sunsetHour) * 60);
            document.getElementById('sunrise-time').textContent = 
                `${sunriseHour.toString().padStart(2,'0')}:${sunriseMin.toString().padStart(2,'0')}`;
            document.getElementById('sunset-time').textContent = 
                `${sunsetHour.toString().padStart(2,'0')}:${sunsetMin.toString().padStart(2,'0')}`;
        }
        
        const sphereRadius = 15;
        const altRad = this.sunCalc.degToRad(sunPos.altitude);
        const azRad = this.sunCalc.degToRad(sunPos.azimuth);
        
        const r = sphereRadius * Math.cos(altRad);
        const x = r * Math.sin(azRad);
        const z = -r * Math.cos(azRad);
        const y = sphereRadius * Math.sin(altRad);
        
        this.sunSphere.position.set(x, y, z);
        this.sunSphere.visible = true;
        
        this.sunLight.position.copy(this.sunSphere.position);
        
        if (sunPos.altitude > 0) {
            this.updateShadow(sunPos.altitude, sunPos.azimuth);
        } else {
            if (this.shadowMesh) {
                this.shadowMesh.visible = false;
            }
        }
        
        this.createTrajectory(date, latitude);
    }

    updateShadow(altitude, azimuth) {
        if (!this.pole) return;
        
        if (altitude <= 0) {
            if (this.shadowMesh) {
                this.shadowMesh.visible = false;
            }
            return;
        }
        
        const polePos = this.pole.position;
        const shadowLength = 4 / Math.tan(this.sunCalc.degToRad(altitude));
        
        const azRad = this.sunCalc.degToRad(azimuth);
        const shadowX = polePos.x + shadowLength * Math.sin(azRad);
        const shadowZ = polePos.z - shadowLength * Math.cos(azRad);
        
        if (!this.shadowMesh) {
            const shadowGeo = new THREE.CircleGeometry(1.2, 16);
            const shadowMat = new THREE.MeshStandardMaterial({
                color: 0x000000,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide,
                emissive: 0x000000
            });
            this.shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
            this.shadowMesh.rotation.x = -Math.PI / 2;
            this.shadowMesh.renderOrder = 2;
            this.shadowMesh.position.y = 0.03;
            this.scene.add(this.shadowMesh);
        }
        
        const stretch = 1 + shadowLength * 0.2;
        this.shadowMesh.scale.set(0, 0, 1);
        this.shadowMesh.position.set(shadowX, 0.03, shadowZ);
        this.shadowMesh.material.opacity = 0.3 + altitude * 0.015;
        this.shadowMesh.visible = true;
    }

    toggleAzimuthLabels(force) {
        if (force !== undefined) {
            this.showAzimuthLabels = force;
        } else {
            this.showAzimuthLabels = !this.showAzimuthLabels;
        }
        
        this.azimuthTickLabels.forEach(label => {
            label.visible = this.showAzimuthLabels;
        });
        
        this.directionLabels.forEach(label => {
            label.visible = this.showAzimuthLabels;
        });
    }

    setView(type) {
        switch(type) {
            case 'default':
                this.camera.position.set(-55, 8, 0);
                this.controls.target.set(0, 0, 0);
                break;
            case 'top':
                this.camera.position.set(0, 55, 0);
                this.controls.target.set(0, 0, 0);
                break;
            case 'side':
                this.camera.position.set(0, 8, 55);
                this.controls.target.set(0, 0, 0);
                break;
        }
        this.controls.update();
    }

    toggleTrajectory() {
        this.showTrajectory = !this.showTrajectory;
        if (!this.showTrajectory && this.trajectoryLine) {
            this.scene.remove(this.trajectoryLine);
            this.trajectoryLine = null;
        } else {
            const date = this.getDateFromDayOfYear(parseInt(document.getElementById('day-of-year').value));
            const latitude = parseFloat(document.getElementById('latitude').value);
            this.createTrajectory(date, latitude);
        }
    }

    getDateFromDayOfYear(dayOfYear) {
        const date = new Date(2024, 0, 1);
        date.setDate(dayOfYear);
        return date;
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());
        
        this.controls.update();
        
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    }
}

// ==================== 初始化 ====================
let visualizer;

// 等待DOM加载完成
document.addEventListener('DOMContentLoaded', () => {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading';
    loadingDiv.textContent = '加载3D场景...';
    document.body.appendChild(loadingDiv);
    
    // 创建可视化实例
    visualizer = new Sun3DVisualizer();
    
    setTimeout(() => {
        document.body.removeChild(loadingDiv);
    }, 1000);
    
    // 获取DOM元素
    const dayOfYearInput = document.getElementById('day-of-year');
    const dayValue = document.getElementById('day-value');
    const latitudeInput = document.getElementById('latitude');
    const latitudeValue = document.getElementById('latitude-value');
    const timeInput = document.getElementById('time');
    const timeValue = document.getElementById('time-value');
    
    // 更新显示函数
    function updateDisplay() {
        const dayOfYear = parseInt(dayOfYearInput.value);
        const date = visualizer.getDateFromDayOfYear(dayOfYear);
        const latitude = parseFloat(latitudeInput.value);
        const time = parseFloat(timeInput.value);
        
        const month = date.getMonth() + 1;
        const day = date.getDate();
        dayValue.textContent = `${month}月${day}日`;
        
        const absLat = Math.abs(latitude);
        const direction = latitude >= 0 ? 'N' : 'S';
        latitudeValue.textContent = `${absLat.toFixed(1)}°${direction}`;
        
        const hours = Math.floor(time);
        const minutes = Math.floor((time - hours) * 60);
        timeValue.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        
        visualizer.updateSunPosition(date, latitude, time);
    }
    
    // 添加事件监听
    dayOfYearInput.addEventListener('input', updateDisplay);
    latitudeInput.addEventListener('input', updateDisplay);
    timeInput.addEventListener('input', updateDisplay);
    
    // 节气按钮
    document.getElementById('vernal-equinox').addEventListener('click', () => {
        dayOfYearInput.value = 80;
        updateDisplay();
    });
    
    document.getElementById('summer-solstice').addEventListener('click', () => {
        dayOfYearInput.value = 172;
        updateDisplay();
    });
    
    document.getElementById('autumnal-equinox').addEventListener('click', () => {
        dayOfYearInput.value = 266;
        updateDisplay();
    });
    
    document.getElementById('winter-solstice').addEventListener('click', () => {
        dayOfYearInput.value = 356;
        updateDisplay();
    });
    
    // 纬度快捷按钮
    document.getElementById('arctic-circle').addEventListener('click', () => {
        latitudeInput.value = 66.5;
        updateDisplay();
    });
    
    document.getElementById('tropic-cancer').addEventListener('click', () => {
        latitudeInput.value = 23.5;
        updateDisplay();
    });
    
    document.getElementById('equator').addEventListener('click', () => {
        latitudeInput.value = 0;
        updateDisplay();
    });
    
    document.getElementById('tropic-capricorn').addEventListener('click', () => {
        latitudeInput.value = -23.5;
        updateDisplay();
    });
    
    document.getElementById('antarctic-circle').addEventListener('click', () => {
        latitudeInput.value = -66.5;
        updateDisplay();
    });
    
    // 初始化更新
    updateDisplay();
});

// ==================== 全局函数 ====================
window.setView = function(type) {
    if (!visualizer) return;
    visualizer.setView(type);
    
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.querySelector(`[onclick="setView('${type}')"]`);
    if (activeBtn) activeBtn.classList.add('active');
};

window.toggleAzimuth = function() {
    if (!visualizer) return;
    visualizer.toggleAzimuthLabels();
    const btn = document.getElementById('azimuthBtn');
    if (btn) {
        btn.classList.toggle('inactive');
    }
};

window.toggleTrajectory = function() {
    if (!visualizer) return;
    visualizer.toggleTrajectory();
    const btn = document.getElementById('trajectoryBtn');
    if (btn) {
        btn.classList.toggle('inactive');
    }
};

window.setTime = function(type) {
    if (!visualizer) return;
    
    const dayOfYear = parseInt(document.getElementById('day-of-year').value);
    const date = visualizer.getDateFromDayOfYear(dayOfYear);
    const latitude = parseFloat(document.getElementById('latitude').value);
    const timeInput = document.getElementById('time');
    
    const { sunrise, sunset, isPolarDay, isPolarNight } = visualizer.sunCalc.calculateSunriseSunset(date, latitude);
    
    switch(type) {
        case 'sunrise':
            if (!isPolarDay && !isPolarNight && sunrise !== null) {
                timeInput.value = sunrise;
            }
            break;
        case 'noon':
            timeInput.value = 12;
            break;
        case 'sunset':
            if (!isPolarDay && !isPolarNight && sunset !== null) {
                timeInput.value = sunset;
            }
            break;
    }
    
    // 触发更新
    timeInput.dispatchEvent(new Event('input'));
};

// ==================== 面板拖动和折叠功能 ====================
setTimeout(function() {
    const panel = document.getElementById('controlPanel');
    const toggleBtn = document.getElementById('togglePanel');
    const sunInfoBar = document.getElementById('sunInfoBar');
    const sunInfoToggle = document.getElementById('toggleSunInfo');
    const viewControls = document.querySelector('.view-controls');
    
    if (!panel || !toggleBtn) {
        console.error('找不到控制面板元素');
        return;
    }
    
    const header = panel.querySelector('.panel-header');
    
    // 折叠功能 - 支持移动端触摸
    function handlePanelToggle(e) {
        e.stopPropagation();
        panel.classList.toggle('collapsed');
        toggleBtn.textContent = panel.classList.contains('collapsed') ? '+' : '−';
    }
    toggleBtn.addEventListener('click', handlePanelToggle);
    
    // 统一的拖动函数
    function makeDraggable(element, handle, pressDuration = 150) {
        let isDragging = false;
        let offsetX, offsetY;
        let longPressTimer = null;
        let startX, startY;
        
        // 保存原始位置用于边界计算
        let originalLeft, originalTop;
        
        // 鼠标事件 - 排除折叠/切换按钮，避免点击按钮时误触发拖动
        handle.addEventListener('mousedown', function(e) {
            const target = e.target;
            if (target.closest && (target.closest('button') || target.closest('.panel-toggle-btn') || target.closest('.sun-info-toggle') || target.closest('.view-controls-toggle'))) {
                return;
            }
            e.preventDefault();
            startDrag(e.clientX, e.clientY);
        });
        
        // 触摸事件 - 使用指定的按压时间，排除折叠/切换按钮的触摸
        handle.addEventListener('touchstart', function(e) {
            const target = e.target;
            if (target.closest && (target.closest('button') || target.closest('.panel-toggle-btn') || target.closest('.sun-info-toggle') || target.closest('.view-controls-toggle'))) {
                return;
            }
            e.preventDefault();
            const touch = e.touches[0];
            
            if (longPressTimer) {
                clearTimeout(longPressTimer);
            }
            
            longPressTimer = setTimeout(() => {
                startDrag(touch.clientX, touch.clientY);
                longPressTimer = null;
            }, pressDuration);
        });
        
        function startDrag(clientX, clientY) {
            isDragging = true;
            element.classList.add('dragging');
            
            const rect = element.getBoundingClientRect();
            offsetX = clientX - rect.left;
            offsetY = clientY - rect.top;
            
            // 获取包含块（.container）的 viewport 位置，将 rect 转为相对于包含块的 left/top
            const container = element.closest('.container') || document.body;
            const containerRect = container.getBoundingClientRect();
            const leftPos = rect.left - containerRect.left + container.scrollLeft;
            const topPos = rect.top - containerRect.top + container.scrollTop;
            
            // 先设置 left/top 再清除 right/bottom，避免 right→left 切换时跳变到左侧
            element.style.left = leftPos + 'px';
            element.style.top = topPos + 'px';
            element.style.right = 'auto';
            element.style.bottom = 'auto';
            element.style.transition = 'none';
        }
        
        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            e.preventDefault();
            drag(e.clientX, e.clientY);
        });
        
        document.addEventListener('touchmove', function(e) {
            if (!isDragging) {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
                return;
            }
            e.preventDefault();
            const touch = e.touches[0];
            drag(touch.clientX, touch.clientY);
        });
        
        function drag(clientX, clientY) {
            let newX = clientX - offsetX;
            let newY = clientY - offsetY;
            
            const elementWidth = element.offsetWidth;
            const elementHeight = element.offsetHeight;
            const maxX = window.innerWidth - elementWidth;
            const maxY = window.innerHeight - elementHeight;
            
            // 限制在屏幕范围内
            newX = Math.max(0, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));
            
            // 持续确保不受 right/bottom 约束影响，防止面板被拉伸
            element.style.right = 'auto';
            element.style.bottom = 'auto';
            element.style.left = newX + 'px';
            element.style.top = newY + 'px';
            
        }
        
        function stopDrag() {
            if (isDragging) {
                isDragging = false;
                element.classList.remove('dragging');
                element.style.transition = '';
            }
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }
        
        document.addEventListener('mouseup', stopDrag);
        document.addEventListener('touchend', stopDrag);
        document.addEventListener('touchcancel', stopDrag);
        
        // 触摸移动时取消长按定时器
        handle.addEventListener('touchmove', function(e) {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }, { passive: true });
    }
    
    // 使三个面板都可拖动，按压时间150ms
    if (header) {
        makeDraggable(panel, header, 150);
    }
    
    if (sunInfoBar) {
        const sunInfoDragHandle = sunInfoBar.querySelector('.sun-info-drag-handle');
        if (sunInfoDragHandle) {
            makeDraggable(sunInfoBar, sunInfoDragHandle, 150);
        } else {
            makeDraggable(sunInfoBar, sunInfoBar, 150);
        }
    }
    
    if (viewControls) {
        makeDraggable(viewControls, viewControls, 150);
        const viewControlsToggle = document.getElementById('toggleViewControls');
        if (viewControlsToggle) {
            viewControlsToggle.addEventListener('click', function(e) {
                e.stopPropagation();
                viewControls.classList.toggle('collapsed');
                viewControlsToggle.textContent = viewControls.classList.contains('collapsed') ? '▶' : '▼';
            });
        }
    }
    
    // 太阳信息栏折叠
    if (sunInfoBar && sunInfoToggle) {
        sunInfoToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            sunInfoBar.classList.toggle('collapsed');
            sunInfoToggle.textContent = sunInfoBar.classList.contains('collapsed') ? '◀' : '▶';
        });
    }
    
    // 初始化按钮状态
    setTimeout(() => {
        if (visualizer) {
            visualizer.showAzimuthLabels = true;
            visualizer.showTrajectory = true;
            visualizer.toggleAzimuthLabels(true);
        }
    }, 500);
    
}, 500);

// ==================== 响应式字体大小调整 ====================
function adjustFontSizeForMobile() {
    if (window.innerWidth <= 768) {
        const root = document.documentElement;
        const width = window.innerWidth;
        
        // 根据屏幕宽度动态计算基础字体大小
        let baseFontSize;
        if (width <= 380) {
            baseFontSize = '12px';
        } else if (width <= 480) {
            baseFontSize = '13px';
        } else {
            baseFontSize = '14px';
        }
        
        root.style.fontSize = baseFontSize;
        
        // 调整控制面板高度
        const panel = document.getElementById('controlPanel');
        if (panel && !panel.classList.contains('collapsed')) {
            const maxHeight = Math.floor(window.innerHeight * 0.3);
            panel.style.maxHeight = maxHeight + 'px';
        }
    }
}

// 监听窗口大小变化
window.addEventListener('resize', adjustFontSizeForMobile);
// 初始化调用
setTimeout(adjustFontSizeForMobile, 100);
