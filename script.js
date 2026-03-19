import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// 太阳位置计算类（保持不变）
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

// 3D场景管理类
class Sun3DVisualizer {
    constructor() {
        this.showAzimuthLabels = true;  // 控制原有方位角标签显示
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
        this.showTrajectory = true;
        this.animationId = null;
        this.clock = new THREE.Clock();
        this.azimuthTickLabels = [];  // 存储原有的方位角刻度标签
        this.directionLabels = [];     // 存储原有的方向标签
        
        this.init();
    }

    init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        // 修正视角：距离增加到35，确保看到整个天球（半径15）
        this.camera.position.set(-35, 8, 0);  // 放在西边，距离35
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
                label.position.set(labelX, -1.5, -labelZ);
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
            label.position.set(dir.pos[0], -1, dir.pos[2]);
            this.scene.add(label);
            this.directionLabels.push(label);
        });
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

    toggleAzimuthLabels() {
        this.showAzimuthLabels = !this.showAzimuthLabels;
        
        // 控制方位角刻度标签的显示/隐藏
        this.azimuthTickLabels.forEach(label => {
            label.visible = this.showAzimuthLabels;
        });
        
        // 控制方向标签（北东南西）的显示/隐藏
        this.directionLabels.forEach(label => {
            label.visible = this.showAzimuthLabels;
        });
    }

    setView(type) {
        // 调整相机位置以确保看到整个天球（半径15）
        switch(type) {
            case 'default':
                // 默认视角：左侧为北，右侧为南，面向东
                this.camera.position.set(-45, 8, 0);
                this.controls.target.set(0, 0, 0);
                break;
            case 'top':
                // 俯视：距离增加到35
                this.camera.position.set(0, 45, 0);
                this.controls.target.set(0, 0, 0);
                break;
            case 'side':
                // 侧视：从北向南看，距离35
                this.camera.position.set(0, 8, -45);
                this.controls.target.set(0, 0, 0);
                break;
        }
        this.controls.update();
    }

    toggleTrajectory() {
        this.showTrajectory = !this.showTrajectory;
        if (!this.showTrajectory && this.trajectoryLine) {
            this.scene.remove(this.trajectoryLine);
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

// 初始化
let visualizer;

document.addEventListener('DOMContentLoaded', () => {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading';
    loadingDiv.textContent = '加载3D场景...';
    document.body.appendChild(loadingDiv);
    
    visualizer = new Sun3DVisualizer();
    
    setTimeout(() => {
        document.body.removeChild(loadingDiv);
    }, 1000);
    
    const dayOfYearInput = document.getElementById('day-of-year');
    const dayValue = document.getElementById('day-value');
    const latitudeInput = document.getElementById('latitude');
    const latitudeValue = document.getElementById('latitude-value');
    const timeInput = document.getElementById('time');
    const timeValue = document.getElementById('time-value');
    
    function updateDisplay() {
        const dayOfYear = parseInt(dayOfYearInput.value);
        const date = visualizer.getDateFromDayOfYear(dayOfYear);
        
        const sliderValue = parseFloat(latitudeInput.value);
        const latitude = 90 - sliderValue;
        
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
    
    latitudeInput.min = 0;
    latitudeInput.max = 180;
    latitudeInput.value = 50;
    
    dayOfYearInput.addEventListener('input', updateDisplay);
    latitudeInput.addEventListener('input', updateDisplay);
    timeInput.addEventListener('input', updateDisplay);
    
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
    
    const arcticCircleBtn = document.getElementById('arctic-circle');
    const tropicCancerBtn = document.getElementById('tropic-cancer');
    const equatorBtn = document.getElementById('equator');
    const tropicCapricornBtn = document.getElementById('tropic-capricorn');
    const antarcticCircleBtn = document.getElementById('antarctic-circle');
    
    if (arcticCircleBtn) {
        arcticCircleBtn.addEventListener('click', () => {
            latitudeInput.value = 90 - 66.5;
            updateDisplay();
        });
    }
    
    if (tropicCancerBtn) {
        tropicCancerBtn.addEventListener('click', () => {
            latitudeInput.value = 90 - 23.5;
            updateDisplay();
        });
    }
    
    if (equatorBtn) {
        equatorBtn.addEventListener('click', () => {
            latitudeInput.value = 90 - 0;
            updateDisplay();
        });
    }
    
    if (tropicCapricornBtn) {
        tropicCapricornBtn.addEventListener('click', () => {
            latitudeInput.value = 90 - (-23.5);
            updateDisplay();
        });
    }
    
    if (antarcticCircleBtn) {
        antarcticCircleBtn.addEventListener('click', () => {
            latitudeInput.value = 90 - (-66.5);
            updateDisplay();
        });
    }
    
    window.setTime = async function(type) {
        const dayOfYear = parseInt(dayOfYearInput.value);
        const date = visualizer.getDateFromDayOfYear(dayOfYear);
        const sliderValue = parseFloat(latitudeInput.value);
        const latitude = 90 - sliderValue;
        
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
        updateDisplay();
    };
    
    window.setView = (type) => visualizer.setView(type);
    window.toggleTrajectory = () => visualizer.toggleTrajectory();
    window.toggleAzimuth = () => visualizer.toggleAzimuthLabels();
    
    updateDisplay();
});

// ===== 面板拖动和折叠功能（单独的事件监听）=====
setTimeout(function() {
    // 控制面板折叠和拖动
    const panel = document.getElementById('controlPanel');
    const toggleBtn = document.getElementById('togglePanel');
    
    if (!panel || !toggleBtn) {
        console.error('找不到控制面板元素');
        return;
    }
    
    const header = panel.querySelector('.panel-header');
    
    // 折叠功能
    toggleBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        panel.classList.toggle('collapsed');
        toggleBtn.textContent = panel.classList.contains('collapsed') ? '+' : '−';
    });
    
    // 拖动功能
    let isDragging = false;
    let offsetX, offsetY;
    
    header.addEventListener('mousedown', function(e) {
        if (e.target === toggleBtn) return;
        
        isDragging = true;
        panel.classList.add('dragging');
        
        const rect = panel.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        
        let newX = e.clientX - offsetX;
        let newY = e.clientY - offsetY;
        
        const panelWidth = panel.offsetWidth;
        const panelHeight = panel.offsetHeight;
        const maxX = window.innerWidth - panelWidth;
        const maxY = window.innerHeight - panelHeight;
        
        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));
        
        panel.style.left = newX + 'px';
        panel.style.top = newY + 'px';
    });
    
    document.addEventListener('mouseup', function() {
        if (isDragging) {
            isDragging = false;
            panel.classList.remove('dragging');
        }
    });
    // 太阳信息栏折叠功能
    const sunInfoBar = document.getElementById('sunInfoBar');
    const sunInfoToggle = document.getElementById('toggleSunInfo');
    
    if (sunInfoBar && sunInfoToggle) {
        sunInfoToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            sunInfoBar.classList.toggle('collapsed');
            sunInfoToggle.textContent = sunInfoBar.classList.contains('collapsed') ? '◀' : '▶';
        });
    }
    
    console.log('面板拖动和折叠功能已初始化');
}, 500);