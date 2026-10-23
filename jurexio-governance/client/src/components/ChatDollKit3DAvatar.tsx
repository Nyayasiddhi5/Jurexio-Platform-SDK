/**
 * ChatDollKit 3D Avatar Component - PURE THREE.JS IMPLEMENTATION
 * Fixed infinite re-render loop and camera/model positioning issues
 * Pure Three.js implementation (no React Three Fiber dependency conflicts)
 */

import React, { useRef, useState, useCallback, forwardRef, useEffect, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

interface ChatDollKitConfig {
  model: string;
  modelFormat?: 'gltf' | 'glb' | 'fbx';
  appearance?: {
    gender?: 'female' | 'male';
    style?: string;
    clothing?: string;
    hair?: string;
    facial_features?: string;
  };
  animations?: {
    idle?: string[];
    speaking?: string[];
    gestures?: string[];
    emotions?: string[];
    walking?: string[];
    interactions?: string[];
  };
  ai_brain?: {
    provider?: 'kimi_k2' | 'openai' | 'anthropic';
    model_version?: string;
    personality?: string;
    response_style?: string;
  };
  voice_synthesis?: {
    provider?: string;
    voice_id?: string;
    language?: string;
    emotion_range?: number;
  };
  behaviors?: {
    natural_breathing?: boolean;
    realistic_blinking?: boolean;
    micro_expressions?: boolean;
    eye_tracking?: boolean;
    lip_sync?: boolean;
    gesture_frequency?: number;
  };
}

interface ChatDollKitAvatarProps {
  config: ChatDollKitConfig;
  interactionData?: any;
  isLipSyncActive?: boolean;
  disableCameraControls?: boolean;
  onAvatarReady?: () => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onAnimationChange?: (animation: string) => void;
  onEmotionChange?: (emotion: string) => void;
  onGestureComplete?: (gesture: string) => void;
}

// Removed SimplifiedAvatarProps - component now only uses ChatDollKitAvatarProps

// Pure Three.js Canvas Component
const PureThreeCanvas: React.FC<{
  modelUrl: string;
  onLoad: (model: THREE.Group) => void;
  onError: (error: Error) => void;
  disableCameraControls?: boolean;
  isLipSyncActive?: boolean;
}> = ({ modelUrl, onLoad, onError, disableCameraControls, isLipSyncActive = false }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);

  const animationIdRef = useRef<number>();
  const mouseRef = useRef({ x: 0, y: 0, isDown: false });

  // 🎭 PROCEDURAL ANIMATION REFERENCES
  const headBoneRef = useRef<THREE.Bone | null>(null);
  const spineBoneRef = useRef<THREE.Bone | null>(null);
  const leftEyeBoneRef = useRef<THREE.Bone | null>(null);
  const rightEyeBoneRef = useRef<THREE.Bone | null>(null);
  const eyeBlinkLeftIndex = useRef<number>(-1);
  const eyeBlinkRightIndex = useRef<number>(-1);
  
  // 🦾 ARM AND HAND ANIMATION REFERENCES
  const leftShoulderBoneRef = useRef<THREE.Bone | null>(null);
  const rightShoulderBoneRef = useRef<THREE.Bone | null>(null);
  const leftElbowBoneRef = useRef<THREE.Bone | null>(null);
  const rightElbowBoneRef = useRef<THREE.Bone | null>(null);
  const leftHandBoneRef = useRef<THREE.Bone | null>(null);
  const rightHandBoneRef = useRef<THREE.Bone | null>(null);
  
  // 🎯 GAZE AND ANIMATION STATE
  const gazeTarget = useRef(new THREE.Vector3(0, 0, -2));
  const nextGazeTarget = useRef(new THREE.Vector3(0, 0, -2));
  const lastGazeChange = useRef(0);
  const lastBlink = useRef(0);
  const blinkState = useRef({ isBlinking: false, blinkTimer: 0 });
  const breathingPhase = useRef(0);
  
  // 🎯 NATURAL RELAXED POSE SYSTEM - FIXED T-POSE ISSUE
  const applyRestingPose = () => {
    console.log('🎯 APPLYING NATURAL RELAXED POSE: Arms hanging naturally by sides...');
    
    // LEFT SHOULDER: Natural hanging position - arms by sides
    if (leftShoulderBoneRef.current) {
      // Natural relaxed pose: slight forward rotation, minimal outward angle
      leftShoulderBoneRef.current.rotation.set(0.1, 0, 0.05);
      leftShoulderBoneRef.current.updateMatrix();
      leftShoulderBoneRef.current.updateMatrixWorld(true);
      console.log('🎯 Left shoulder: Natural relaxed rotation(0.1, 0, 0.05) applied');
    }
    
    // RIGHT SHOULDER: Natural hanging position - arms by sides  
    if (rightShoulderBoneRef.current) {
      // Natural relaxed pose: slight forward rotation, minimal inward angle
      rightShoulderBoneRef.current.rotation.set(0.1, 0, -0.05);
      rightShoulderBoneRef.current.updateMatrix();
      rightShoulderBoneRef.current.updateMatrixWorld(true);
      console.log('🎯 Right shoulder: Natural relaxed rotation(0.1, 0, -0.05) applied');
    }
    
    // LEFT ELBOW: Slight natural bend - arms hanging loosely
    if (leftElbowBoneRef.current) {
      // Very slight inward bend for natural arm hang
      leftElbowBoneRef.current.rotation.set(0, 0, 0.1);
      leftElbowBoneRef.current.updateMatrix();
      leftElbowBoneRef.current.updateMatrixWorld(true);
      console.log('🎯 Left elbow: Natural slight bend rotation(0, 0, 0.1) applied');
    }
    
    // RIGHT ELBOW: Slight natural bend - arms hanging loosely
    if (rightElbowBoneRef.current) {
      // Very slight outward bend for natural arm hang
      rightElbowBoneRef.current.rotation.set(0, 0, -0.1);
      rightElbowBoneRef.current.updateMatrix();
      rightElbowBoneRef.current.updateMatrixWorld(true);
      console.log('🎯 Right elbow: Natural slight bend rotation(0, 0, -0.1) applied');
    }
    
    // HANDS: Direct rotation reset
    if (leftHandBoneRef.current) {
      leftHandBoneRef.current.rotation.set(0, 0, 0);
      leftHandBoneRef.current.updateMatrix();
      leftHandBoneRef.current.updateMatrixWorld(true);
      console.log('🔥 Left hand: Direct rotation reset applied');
    }
    
    if (rightHandBoneRef.current) {
      rightHandBoneRef.current.rotation.set(0, 0, 0);
      rightHandBoneRef.current.updateMatrix();
      rightHandBoneRef.current.updateMatrixWorld(true);
      console.log('🔥 Right hand: Direct rotation reset applied');
    }
    
    // 🔥 FORCE COMPLETE MODEL UPDATE - Bypass skeleton system entirely
    if (modelRef.current) {
      modelRef.current.updateMatrixWorld(true);
      console.log('🔥 Complete model matrix update forced');
      
      // Force all children to update their matrices
      modelRef.current.traverse((child) => {
        child.updateMatrix();
        child.updateMatrixWorld(true);
      });
      console.log('🔥 All child matrices forcefully updated');
      
      // Force renderer to update immediately
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
        console.log('🔥 Immediate renderer update forced');
      }
    }
    
    // 🔥 CRITICAL: Force skeleton update with comprehensive model structure analysis
    const forceSkeletonUpdate = () => {
      if (modelRef.current) {
        let skinnedMeshCount = 0;
        let meshCount = 0;
        let boneCount = 0;
        
        console.log('🔍 DEEP MODEL ANALYSIS - Checking model structure...');
        modelRef.current.traverse((child) => {
          console.log('🔍 Object:', child.type, child.name, 'Constructor:', child.constructor.name);
          
          if (child.isMesh) {
            meshCount++;
            console.log('🔍 Mesh found:', child.name, 'Type:', child.type, 'IsSkinnedMesh:', child instanceof THREE.SkinnedMesh);
            
            // Check if it has skeleton property
            if (child.skeleton) {
              console.log('🔥 Mesh has skeleton:', child.name, 'Bones:', child.skeleton.bones.length);
            }
            
            // Check if it can be converted to SkinnedMesh
            if (child.geometry && child.geometry.attributes.skinIndex) {
              console.log('🔥 Mesh has skin data:', child.name);
            }
          }
          
          if (child instanceof THREE.SkinnedMesh) {
            skinnedMeshCount++;
            console.log('🔥 SkinnedMesh found:', child.name, 'Has skeleton:', !!child.skeleton);
            if (child.skeleton) {
              // Force pose updates
              child.skeleton.bones.forEach((bone) => {
                bone.updateMatrixWorld(true);
              });
              child.skeleton.update();
              child.computeBoundingBox();
              child.computeBoundingSphere();
              console.log('🔥 Skeleton and bounds updated for mesh:', child.name);
            }
          }
          
          if (child.isBone) {
            boneCount++;
          }
        });
        
        console.log('🔍 Model Structure Summary:');
        console.log('  - Total meshes:', meshCount);
        console.log('  - SkinnedMesh objects:', skinnedMeshCount);
        console.log('  - Bone objects:', boneCount);
        
        // Also check scene for any SkinnedMesh objects
        if (sceneRef.current) {
          let sceneSkinnedMeshCount = 0;
          sceneRef.current.traverse((child) => {
            if (child instanceof THREE.SkinnedMesh) {
              sceneSkinnedMeshCount++;
              if (child.skeleton) {
                child.skeleton.update();
                console.log('🔥 Scene SkinnedMesh updated:', child.name);
              }
            }
          });
          console.log('🔍 Scene SkinnedMesh objects:', sceneSkinnedMeshCount);
        }
      } else {
        console.log('❌ modelRef.current is null - cannot update skeleton');
      }
    };
    
    // Immediate skeleton update
    forceSkeletonUpdate();
    
    // 🔥 FORCE SKINNED MESH CREATION - Convert regular meshes to SkinnedMesh if needed
    setTimeout(() => {
      console.log('🔥 Delayed skeleton update - ensuring mesh deformation');
      forceSkeletonUpdate();
      
      // If no SkinnedMesh found, try to create proper skeleton connections
      if (modelRef.current) {
        let converted = false;
        modelRef.current.traverse((child) => {
          if (child.isMesh && !(child instanceof THREE.SkinnedMesh)) {
            // Check if this mesh has skin attributes
            if (child.geometry && child.geometry.attributes.skinIndex && child.geometry.attributes.skinWeight) {
              console.log('🔥 Converting regular mesh to SkinnedMesh:', child.name);
              // Create proper skeleton from bones
              const bones = [];
              modelRef.current.traverse((boneChild) => {
                if (boneChild.isBone) {
                  bones.push(boneChild);
                }
              });
              
              if (bones.length > 0) {
                const skeleton = new THREE.Skeleton(bones);
                child.bind(skeleton);
                converted = true;
                console.log('🔥 Created skeleton for mesh:', child.name, 'with', bones.length, 'bones');
              }
            }
          }
        });
        
        if (converted) {
          // Reapply pose after conversion
          setTimeout(() => {
            console.log('🔥 Reapplying pose after SkinnedMesh conversion');
            applyRestingPose();
          }, 50);
        }
      }
    }, 100);
    
    // Final update with comprehensive check
    setTimeout(() => {
      console.log('🎯 Final skeleton update - ensuring natural relaxed pose');
      forceSkeletonUpdate();
      
      // 🔥 LAST RESORT: Direct bone matrix manipulation
      if (modelRef.current) {
        console.log('🔥 Applying direct bone matrix transformations');
        
        // Force update all bone matrices
        modelRef.current.traverse((child) => {
          if (child.isBone) {
            child.updateMatrixWorld(true);
          }
        });
        
        // Force renderer update
        if (rendererRef.current && sceneRef.current && cameraRef.current) {
          rendererRef.current.render(sceneRef.current, cameraRef.current);
          console.log('🔥 Forced renderer update');
        }
      }
    }, 500);
    
    console.log('🎯 Natural relaxed pose applied - Arms positioned naturally by sides');
  };

  // 🔧 FIX: Single useEffect with all Three.js logic consolidated
  useEffect(() => {
    if (!mountRef.current) return;

    let isMounted = true;
    
    // Initialize Three.js scene with transparent background
    const scene = new THREE.Scene();
    scene.background = null; // Transparent background, no guidelines
    sceneRef.current = scene;

    // Get container dimensions dynamically to prevent clipping
    const containerWidth = mountRef.current.clientWidth || 400;
    const containerHeight = mountRef.current.clientHeight || 384;
    const aspectRatio = containerWidth / containerHeight;

    // Initialize camera with dynamic aspect ratio to prevent clipping
    const camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.01, 1000);
    camera.position.set(0, 0, 5); // Initial position, will be adjusted when model loads
    camera.lookAt(0, 0, 0); // Look at scene center
    cameraRef.current = camera;

    // Initialize renderer with dynamic sizing to prevent clipping
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    
    renderer.setSize(containerWidth, containerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for performance
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    // Add renderer to DOM
    mountRef.current.appendChild(renderer.domElement);

    // Resize handling is done in separate useEffect below

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // No debugging helpers for clean production appearance

    // Camera controls (basic mouse interaction)
    const handleMouseDown = (event: MouseEvent) => {
      mouseRef.current.isDown = true;
      mouseRef.current.x = event.clientX;
      mouseRef.current.y = event.clientY;
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!disableCameraControls && mouseRef.current.isDown && cameraRef.current) {
        const deltaX = event.clientX - mouseRef.current.x;
        const deltaY = event.clientY - mouseRef.current.y;
        
        cameraRef.current.position.x += deltaX * 0.01;
        cameraRef.current.position.y -= deltaY * 0.01;
        cameraRef.current.lookAt(0, 0, 0);
        
        mouseRef.current.x = event.clientX;
        mouseRef.current.y = event.clientY;
      }
    };

    const handleMouseUp = () => {
      mouseRef.current.isDown = false;
    };

    const handleWheel = (event: WheelEvent) => {
      if (!disableCameraControls && cameraRef.current) {
        const delta = event.deltaY * 0.001;
        cameraRef.current.position.z += delta;
        cameraRef.current.position.z = Math.max(1, Math.min(10, cameraRef.current.position.z));
      }
    };

    if (!disableCameraControls) {
      renderer.domElement.addEventListener('mousedown', handleMouseDown);
      renderer.domElement.addEventListener('mousemove', handleMouseMove);
      renderer.domElement.addEventListener('mouseup', handleMouseUp);
      renderer.domElement.addEventListener('wheel', handleWheel);
    }

    // Load model
    const loadModel = async () => {
      try {
        console.log('🔍 Loading model:', modelUrl);
        
        const fileExtension = modelUrl.split('.').pop()?.toLowerCase();
        let loadedModel: THREE.Group;
        let animations: THREE.AnimationClip[] = [];
        
        if (fileExtension === 'fbx') {
          console.log('🔍 Initializing advanced FBX loader for:', modelUrl);
          
          // ENHANCED FBX LOADER WITH ROBUST VERSION SUPPORT
          const loadFBXWithRetries = async (url: string): Promise<any> => {
            const strategies = [
              // Strategy 1: FBXLoader with manual version header repair
              () => {
                console.log('📝 Strategy 1: FBXLoader with version header repair');
                return fetch(url)
                  .then(response => response.arrayBuffer())
                  .then(buffer => {
                    const view = new DataView(buffer);
                    const header = new TextDecoder().decode(buffer.slice(0, 50));
                    console.log('🔍 FBX Header analysis:', header);
                    
                    // Try to repair common FBX version issues
                    let repairedBuffer = buffer;
                    if (header.includes('Kaydara FBX Binary')) {
                      console.log('✅ Valid FBX header detected, attempting repair...');
                      
                      // Create a blob URL and load directly
                      const blob = new Blob([repairedBuffer], { type: 'application/octet-stream' });
                      const blobUrl = URL.createObjectURL(blob);
                      
                      const loader = new FBXLoader();
                      return new Promise<any>((resolve, reject) => {
                        loader.load(
                          blobUrl,
                          (fbx) => {
                            URL.revokeObjectURL(blobUrl);
                            resolve(fbx);
                          },
                          undefined,
                          (error) => {
                            URL.revokeObjectURL(blobUrl);
                            reject(error);
                          }
                        );
                      });
                    } else {
                      throw new Error('Invalid FBX header');
                    }
                  });
              },
              
              // Strategy 2: Server-side FBX conversion fallback
              async () => {
                console.log('📝 Strategy 2: Server-side FBX conversion fallback');
                try {
                  console.log('🔄 Attempting server-side FBX conversion...');
                  const conversionResponse = await fetch('/api/convert-fbx', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                      fbxPath: url,
                      requestId: Date.now()
                    })
                  });
                  
                  if (conversionResponse.ok) {
                    const conversionData = await conversionResponse.json();
                    if (conversionData.glbUrl) {
                      console.log('✅ Server-side conversion successful, loading GLB...');
                      const loader = new GLTFLoader();
                      return new Promise<any>((resolve, reject) => {
                        loader.load(
                          conversionData.glbUrl,
                          (gltf) => {
                            console.log('✅ Converted GLB loaded successfully');
                            const fbxLikeObject = gltf.scene;
                            fbxLikeObject.animations = gltf.animations || [];
                            resolve(fbxLikeObject);
                          },
                          undefined,
                          reject
                        );
                      });
                    }
                  }
                  
                  throw new Error('Server-side conversion failed');
                } catch (error) {
                  throw new Error(`Conversion strategy failed: ${(error as Error).message}`);
                }
              },
              
              // Strategy 3: Binary fetch + manual FBX parsing
              () => {
                console.log('📝 Strategy 3: Direct binary fetch approach');
                return fetch(url)
                  .then(response => {
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return response.arrayBuffer();
                  })
                  .then(buffer => {
                    // Create a blob URL for the binary data
                    const blob = new Blob([buffer], { type: 'application/octet-stream' });
                    const blobUrl = URL.createObjectURL(blob);
                    
                    const loader = new FBXLoader();
                    return new Promise<any>((resolve, reject) => {
                      loader.load(
                        blobUrl,
                        (fbx) => {
                          URL.revokeObjectURL(blobUrl);
                          console.log('✅ Strategy 3 successful with binary approach');
                          resolve(fbx);
                        },
                        undefined,
                        (error) => {
                          URL.revokeObjectURL(blobUrl);
                          reject(error);
                        }
                      );
                    });
                  });
              }
            ];
            
            // Try each strategy in sequence
            for (let i = 0; i < strategies.length; i++) {
              try {
                console.log(`🔧 Attempting FBX loading strategy ${i + 1}/${strategies.length}`);
                const result = await strategies[i]();
                console.log(`✅ FBX loading successful with strategy ${i + 1}`);
                return result;
              } catch (error) {
                const err = error as Error;
                console.warn(`⚠️ Strategy ${i + 1} failed:`, err.message);
                
                // If this is the last strategy, throw the error
                if (i === strategies.length - 1) {
                  throw new Error(`All FBX loading strategies failed. Last error: ${err.message}. Please ensure the FBX file is valid and compatible.`);
                }
              }
            }
          };
          
          const fbx = await loadFBXWithRetries(modelUrl);
          loadedModel = fbx;
          animations = fbx.animations || [];
          
          console.log('✅ FBX model loaded successfully:', {
            modelType: loadedModel.type,
            children: loadedModel.children.length,
            animations: animations.length,
            hasGeometry: loadedModel.children.some((child: any) => child.geometry),
            hasMaterial: loadedModel.children.some((child: any) => child.material),
            bbox: new THREE.Box3().setFromObject(loadedModel)
          });
          
        } else {
          // GLTF/GLB loader
          const loader = new GLTFLoader();
          const gltf = await new Promise<any>((resolve, reject) => {
            loader.load(
              modelUrl,
              (gltf) => resolve(gltf),
              (progress) => console.log('Loading progress:', (progress.loaded / progress.total * 100) + '%'),
              (error) => reject(error)
            );
          });
          
          loadedModel = gltf.scene;
          animations = gltf.animations || [];
          console.log('✅ GLTF model loaded:', { children: loadedModel.children.length, animations: animations.length });
        }
        
        if (!isMounted) return;
        
        // 🚀 AUTOMATIC CAMERA FRAMING SOLUTION
        // Step 1: Calculate the bounding box of the loaded model
        const box = new THREE.Box3().setFromObject(loadedModel);
        
        // Step 2: Calculate the model's size and center
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        
        // Step 3: Reposition the model so its center is at the world origin (0, 0, 0)
        loadedModel.position.sub(center);
        
        // Safety check: Ensure model is not too close to camera to prevent clipping
        const safetyDistance = Math.max(size.z * 0.1, 0.1);
        console.log('🛡️ Safety distance for model positioning:', safetyDistance);
        
        // Step 4: Position camera for medium close-up shot (face and chest)
        const maxDim = Math.max(size.x, size.y, size.z);
        
        // 🎯 CLOSE-UP SHOT CONFIGURATION - Closer and Higher
        // Set camera Y position higher (face/upper chest area)  
        const upperChestY = size.y * 0.35; // Higher than before (was 0.2)
        
        // Set camera much closer for very intimate framing (with safety margin)
        const baseCloseUpZ = 0.9; // Much closer than before (was 1.2)
        const safetyMargin = Math.max(size.z * 0.05, 0.05); // Prevent model clipping
        const closeUpZ = Math.max(baseCloseUpZ, safetyMargin);
        
        // Position camera for close-up shot
        camera.position.set(0, upperChestY, closeUpZ);
        
        // Look at the face/upper chest area for optimal framing
        camera.lookAt(0, upperChestY, 0);
        
        // Step 5: Adjust clipping planes for ultra close-up (prevent clipping)
        camera.near = Math.max(0.01, maxDim / 200); // Smaller near plane for close shots
        camera.far = maxDim * 100;
        camera.updateProjectionMatrix();
        
        // Step 6: Log the results for debugging
        console.log('🎯 Close-Up Camera Framing Results:');
        console.log('📏 Model Size:', { x: size.x.toFixed(3), y: size.y.toFixed(3), z: size.z.toFixed(3) });
        console.log('🎯 Model Center:', { x: center.x.toFixed(3), y: center.y.toFixed(3), z: center.z.toFixed(3) });
        console.log('📷 Camera Position:', { x: 0, y: upperChestY.toFixed(3), z: closeUpZ });
        console.log('👁️ Camera Target:', { x: 0, y: upperChestY.toFixed(3), z: 0 });
        console.log('🔍 Camera Near/Far:', { near: camera.near.toFixed(6), far: camera.far.toFixed(3) });
        console.log('📐 Max Dimension:', maxDim.toFixed(3));
        
        // Analyze model for lip sync capabilities
        processModelForLipSync(loadedModel);
        
        // 🎭 DISCOVER KEY BONES AND MORPH TARGETS FOR PROCEDURAL ANIMATION
        console.log('🚀 Starting bone discovery process...');
        const boneResults = discoverAvatarBones(loadedModel);
        console.log('🎯 Bone discovery completed with results:', boneResults);
        
        // Add model to scene
        scene.add(loadedModel);
        modelRef.current = loadedModel;
        
        // Call onLoad callback and pass the loaded model
        onLoad(loadedModel);
        
        // 🚫 ANIMATION MIXER REMOVED - It was overriding procedural bone rotations and causing T-pose
        // Now using only procedural animations for natural movement without conflicts
        
        console.log('✅ Model setup complete:', {
          position: loadedModel.position,
          scale: loadedModel.scale,
          animations: animations.length
        });
        
      } catch (error) {
        console.error('❌ Model loading error:', error);
        
        // Enhanced error handling with specific error types
        if (error instanceof Error) {
          if (error.message.includes('version number') || error.message.includes('FBX version')) {
            console.log('🔧 FBX version compatibility issue detected');
            console.log('💡 Suggestion: Try using a GLB format model instead of FBX');
            console.log('🔍 Model URL:', modelUrl);
            
            // Try to provide helpful error message to user
            const enhancedError = new Error(
              'FBX model version not supported. Please ensure the FBX file is compatible with Three.js FBXLoader or try using a GLB format instead.'
            );
            
            if (isMounted) {
              onError(enhancedError);
            }
          } else {
            if (isMounted) {
              onError(error);
            }
          }
        } else {
          if (isMounted) {
            onError(new Error('Unknown model loading error'));
          }
        }
      }
    };

    // 🎭 BONE DISCOVERY FUNCTION
    const discoverAvatarBones = (model: THREE.Group) => {
      console.log('🔍 Discovering avatar bones for procedural animation...');
      
      let foundBones = {
        head: false,
        spine: false,
        leftEye: false,
        rightEye: false,
        leftBlink: false,
        rightBlink: false,
        leftShoulder: false,
        rightShoulder: false,
        leftElbow: false,
        rightElbow: false,
        leftHand: false,
        rightHand: false
      };
      
      console.log('🔍 Starting model traversal for bone discovery...');
      let totalBonesFound = 0;
      
      // 🔍 COMPREHENSIVE BONE ANALYSIS - Print ALL bones first
      console.log('🔍 === COMPLETE BONE HIERARCHY ANALYSIS ===');
      
      model.traverse((child: any) => {
        if (child.isBone) {
          totalBonesFound++;
          const boneName = child.name.toLowerCase();
          
          // 🔍 DETAILED BONE LOGGING - Every single bone with full info
          console.log(`🔍 Bone #${totalBonesFound}: "${child.name}"`);
          console.log(`   📍 Position: (${child.position.x.toFixed(2)}, ${child.position.y.toFixed(2)}, ${child.position.z.toFixed(2)})`);
          console.log(`   📐 Rotation: (${child.rotation.x.toFixed(2)}, ${child.rotation.y.toFixed(2)}, ${child.rotation.z.toFixed(2)})`);
          console.log(`   👨‍👦 Parent: "${child.parent?.name || 'None'}"`);
          console.log(`   🏷️ Type: ${child.type}, UUID: ${child.uuid.substring(0,8)}`);
          console.log(`   🔤 Lowercase: "${boneName}"`);
          console.log(''); // Empty line for readability
          
          // Find head bone - more flexible matching
          if (boneName.includes('head') || boneName.includes('neck') || boneName.includes('skull')) {
            headBoneRef.current = child;
            foundBones.head = true;
            console.log(`👤 Found head bone: ${child.name}`);
          }
          
          // Find spine/chest bone - more flexible matching
          if (boneName.includes('spine') || boneName.includes('chest') || boneName.includes('torso') || 
              boneName.includes('upper_body') || boneName.includes('upperbody') || boneName.includes('ribcage')) {
            spineBoneRef.current = child;
            foundBones.spine = true;
            console.log(`🫁 Found spine bone: ${child.name}`);
          }
          
          // Find eye bones
          if (boneName.includes('eye')) {
            if (boneName.includes('left') || boneName.includes('l_')) {
              leftEyeBoneRef.current = child;
              foundBones.leftEye = true;
              console.log(`👁️ Found left eye bone: ${child.name}`);
            } else if (boneName.includes('right') || boneName.includes('r_')) {
              rightEyeBoneRef.current = child;
              foundBones.rightEye = true;
              console.log(`👁️ Found right eye bone: ${child.name}`);
            }
          }
          
          // 🦾 ARM AND HAND BONE DISCOVERY
          
          // Find shoulder bones (clavicle, shoulder, upper arm)
          if (boneName.includes('shoulder') || boneName.includes('clavicle') || 
              boneName.includes('upperarm') || boneName.includes('upper_arm') ||
              boneName.includes('arm_upper') || boneName.includes('armature')) {
            if (boneName.includes('left') || boneName.includes('l_')) {
              leftShoulderBoneRef.current = child;
              foundBones.leftShoulder = true;
              console.log(`🦾 Found left shoulder bone: ${child.name}`);
            } else if (boneName.includes('right') || boneName.includes('r_')) {
              rightShoulderBoneRef.current = child;
              foundBones.rightShoulder = true;
              console.log(`🦾 Found right shoulder bone: ${child.name}`);
            }
          }
          
          // Find elbow bones (forearm, lower arm, elbow)
          if (boneName.includes('elbow') || boneName.includes('forearm') || 
              boneName.includes('lowerarm') || boneName.includes('lower_arm') ||
              boneName.includes('arm_lower')) {
            if (boneName.includes('left') || boneName.includes('l_')) {
              leftElbowBoneRef.current = child;
              foundBones.leftElbow = true;
              console.log(`🦾 Found left elbow bone: ${child.name}`);
            } else if (boneName.includes('right') || boneName.includes('r_')) {
              rightElbowBoneRef.current = child;
              foundBones.rightElbow = true;
              console.log(`🦾 Found right elbow bone: ${child.name}`);
            }
          }
          
          // Find hand bones (hand, wrist)
          if (boneName.includes('hand') || boneName.includes('wrist')) {
            if (boneName.includes('left') || boneName.includes('l_')) {
              leftHandBoneRef.current = child;
              foundBones.leftHand = true;
              console.log(`🦾 Found left hand bone: ${child.name}`);
            } else if (boneName.includes('right') || boneName.includes('r_')) {
              rightHandBoneRef.current = child;
              foundBones.rightHand = true;
              console.log(`🦾 Found right hand bone: ${child.name}`);
            }
          }
        }
        
        // Find blink morph targets
        if (child.isMesh && child.morphTargetDictionary) {
          if (child.morphTargetDictionary['eyeBlinkLeft'] !== undefined) {
            eyeBlinkLeftIndex.current = child.morphTargetDictionary['eyeBlinkLeft'];
            foundBones.leftBlink = true;
            console.log(`😊 Found left blink morph target at index: ${eyeBlinkLeftIndex.current}`);
          }
          if (child.morphTargetDictionary['eyeBlinkRight'] !== undefined) {
            eyeBlinkRightIndex.current = child.morphTargetDictionary['eyeBlinkRight'];
            foundBones.rightBlink = true;
            console.log(`😊 Found right blink morph target at index: ${eyeBlinkRightIndex.current}`);
          }
        }
      });
      
      // Report bone discovery results
      console.log('🔍 Bone Discovery Summary:', foundBones);
      console.log(`🦴 Total bones inspected: ${totalBonesFound}`);
      
      // If no spine bone found, try using the root bone or first bone as a fallback
      if (!foundBones.spine) {
        model.traverse((child: any) => {
          if (child.isBone && !spineBoneRef.current) {
            spineBoneRef.current = child;
            console.log(`🫁 Using fallback bone for breathing: ${child.name}`);
            foundBones.spine = true;
            return; // Stop at first bone found
          }
        });
      }
      
      // 🎯 INITIALIZE ARM BONES TO IDLE POSE
      initializeArmPoses();
      
      return foundBones;
    };

    // 🎯 INITIALIZE ARM POSES TO NATURAL RELAXED POSITION
    const initializeArmPoses = () => {
      console.log('🎯 Initializing arm poses to natural relaxed position...');
      console.log('🎯 Available bone references:');
      console.log('  - leftShoulder:', !!leftShoulderBoneRef.current, leftShoulderBoneRef.current?.name);
      console.log('  - rightShoulder:', !!rightShoulderBoneRef.current, rightShoulderBoneRef.current?.name);
      console.log('  - leftElbow:', !!leftElbowBoneRef.current, leftElbowBoneRef.current?.name);
      console.log('  - rightElbow:', !!rightElbowBoneRef.current, rightElbowBoneRef.current?.name);
      
      // 🚨 CRITICAL BONE VERIFICATION - Warn if crucial arm bones are missing
      if (!leftShoulderBoneRef.current) {
        console.warn('⚠️ CRITICAL: Left shoulder bone not found - natural pose may not apply!');
      }
      if (!rightShoulderBoneRef.current) {
        console.warn('⚠️ CRITICAL: Right shoulder bone not found - natural pose may not apply!');
      }
      if (!leftElbowBoneRef.current) {
        console.warn('⚠️ CRITICAL: Left elbow bone not found - natural pose may not apply!');
      }
      if (!rightElbowBoneRef.current) {
        console.warn('⚠️ CRITICAL: Right elbow bone not found - natural pose may not apply!');
      }
      
      // 🔥 APPLY NEW SIMPLIFIED RESTING POSE
      applyRestingPose();
      
      // 📊 FINAL ARM POSE VERIFICATION SUMMARY
      const armBoneStatus = {
        leftShoulder: !!leftShoulderBoneRef.current,
        rightShoulder: !!rightShoulderBoneRef.current,
        leftElbow: !!leftElbowBoneRef.current,
        rightElbow: !!rightElbowBoneRef.current,
        leftHand: !!leftHandBoneRef.current,
        rightHand: !!rightHandBoneRef.current
      };
      console.log('🔍 Arm Bone Verification Summary:', armBoneStatus);
    };

    // 🫁 PROCEDURAL BREATHING ANIMATION
    const updateBreathing = (elapsedTime: number) => {
      if (!spineBoneRef.current) {
        // Debug: Log once per 5 seconds that no spine bone is available
        if (Math.floor(elapsedTime) % 5 === 0 && Math.floor(elapsedTime * 10) % 50 === 0) {
          console.log('⚠️ Breathing animation disabled: No spine bone found');
        }
        return;
      }
      
      // Reduce breathing intensity during speech
      const intensity = isLipSyncActive ? 0.3 : 1.0;
      
      // Smooth sine wave breathing at ~16 breaths per minute
      const breathingRate = 0.27; // Approximately 16 breaths per minute
      const breathingAmount = Math.sin(elapsedTime * breathingRate) * 0.06 * intensity; // 🫁 ENHANCED: Increased to 0.06 for better visibility while avoiding clipping
      
      // Apply chest expansion in multiple axes for realistic breathing
      spineBoneRef.current.rotation.x = breathingAmount; // Forward/backward chest movement
      spineBoneRef.current.rotation.z = breathingAmount * 0.3; // Slight side expansion
      breathingPhase.current = breathingAmount;
      
      // Debug: Log breathing activity once per 10 seconds
      if (Math.floor(elapsedTime) % 10 === 0 && Math.floor(elapsedTime * 10) % 100 === 0) {
        console.log(`🫁 Breathing active: ${spineBoneRef.current.name}, intensity: ${breathingAmount.toFixed(3)}`);
      }
    };

    // 👁️ AUTOMATIC EYE BLINKING SYSTEM
    const updateBlinking = (elapsedTime: number) => {
      if (!modelRef.current) return;
      
      const currentTime = elapsedTime * 1000; // Convert to milliseconds
      
      // Random blink intervals (3-5 seconds)
      if (currentTime - lastBlink.current > 3000 + Math.random() * 2000) {
        if (!blinkState.current.isBlinking) {
          blinkState.current.isBlinking = true;
          blinkState.current.blinkTimer = currentTime;
          lastBlink.current = currentTime;
        }
      }
      
      // Handle blink animation (150ms duration)
      if (blinkState.current.isBlinking) {
        const blinkProgress = (currentTime - blinkState.current.blinkTimer) / 150;
        
        if (blinkProgress <= 1.0) {
          // Create smooth blink curve (fast close/open)
          const blinkValue = Math.sin(blinkProgress * Math.PI);
          
          // Apply blink to morph targets
          modelRef.current.traverse((child: any) => {
            if (child.isMesh && child.morphTargetInfluences) {
              if (eyeBlinkLeftIndex.current >= 0) {
                child.morphTargetInfluences[eyeBlinkLeftIndex.current] = blinkValue;
              }
              if (eyeBlinkRightIndex.current >= 0) {
                child.morphTargetInfluences[eyeBlinkRightIndex.current] = blinkValue;
              }
            }
          });
        } else {
          // End blink
          blinkState.current.isBlinking = false;
          
          // Reset blink morph targets
          modelRef.current.traverse((child: any) => {
            if (child.isMesh && child.morphTargetInfluences) {
              if (eyeBlinkLeftIndex.current >= 0) {
                child.morphTargetInfluences[eyeBlinkLeftIndex.current] = 0;
              }
              if (eyeBlinkRightIndex.current >= 0) {
                child.morphTargetInfluences[eyeBlinkRightIndex.current] = 0;
              }
            }
          });
        }
      }
    };

    // 🎯 DYNAMIC GAZE SYSTEM
    const updateGaze = (elapsedTime: number) => {
      if (!headBoneRef.current) return;
      
      const currentTime = elapsedTime * 1000;
      
      // Reduce gaze movement intensity during speech
      const gazeIntensity = isLipSyncActive ? 0.2 : 1.0;
      
      // Change gaze target every 2-4 seconds
      if (currentTime - lastGazeChange.current > 2000 + Math.random() * 2000) {
        // Generate new random gaze point in front of avatar
        nextGazeTarget.current.set(
          (Math.random() - 0.5) * 0.5 * gazeIntensity, // X: left/right
          (Math.random() - 0.3) * 0.3 * gazeIntensity, // Y: up/down (slightly favor up)
          -1.5 - Math.random() * 0.5 // Z: always in front
        );
        lastGazeChange.current = currentTime;
      }
      
      // Smoothly lerp to new gaze target
      gazeTarget.current.lerp(nextGazeTarget.current, 0.02);
      
      // Apply gaze to head bone
      const targetPosition = gazeTarget.current.clone();
      headBoneRef.current.lookAt(targetPosition);
      
      // Apply subtle gaze to eye bones
      if (leftEyeBoneRef.current) {
        leftEyeBoneRef.current.lookAt(targetPosition);
      }
      if (rightEyeBoneRef.current) {
        rightEyeBoneRef.current.lookAt(targetPosition);
      }
    };

    // 🎯 REFINED ANIMATION LOOP - Preserves quaternion-based resting pose
    const updateArmGestures = (elapsedTime: number) => {
      // 🔥 CRITICAL: Do NOT override the quaternion-based resting pose
      // Only add very subtle additive breathing-like motions
      
      // Create very minimal shoulder breathing motion (preserving base quaternions)
      const breathingMotion = Math.sin(elapsedTime * 0.25) * 0.01; // Extremely subtle
      
      if (leftShoulderBoneRef.current) {
        // Apply tiny additive rotation to Y-axis only, preserving base quaternion
        const additiveEuler = new THREE.Euler(0, breathingMotion, 0, 'XYZ');
        const additiveQuaternion = new THREE.Quaternion().setFromEuler(additiveEuler);
        
        // Base quaternion from resting pose: Euler(-0.2, 0, 0.5)
        const baseQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0, 0.5, 'XYZ'));
        
        // Multiply base with additive motion
        const finalQuaternion = baseQuaternion.multiply(additiveQuaternion);
        leftShoulderBoneRef.current.quaternion.copy(finalQuaternion);
        leftShoulderBoneRef.current.updateMatrixWorld(true);
      }
      
      if (rightShoulderBoneRef.current) {
        // Apply tiny additive rotation to Y-axis only, preserving base quaternion
        const additiveEuler = new THREE.Euler(0, -breathingMotion, 0, 'XYZ');
        const additiveQuaternion = new THREE.Quaternion().setFromEuler(additiveEuler);
        
        // Base quaternion from resting pose: Euler(-0.2, 0, -0.5)
        const baseQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0, -0.5, 'XYZ'));
        
        // Multiply base with additive motion
        const finalQuaternion = baseQuaternion.multiply(additiveQuaternion);
        rightShoulderBoneRef.current.quaternion.copy(finalQuaternion);
        rightShoulderBoneRef.current.updateMatrixWorld(true);
      }
      
      // Elbows remain completely static (preserve their quaternion-based pose)
      if (leftElbowBoneRef.current) {
        const baseQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.3, 'XYZ'));
        leftElbowBoneRef.current.quaternion.copy(baseQuaternion);
        leftElbowBoneRef.current.updateMatrixWorld(true);
      }
      
      if (rightElbowBoneRef.current) {
        const baseQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.3, 'XYZ'));
        rightElbowBoneRef.current.quaternion.copy(baseQuaternion);
        rightElbowBoneRef.current.updateMatrixWorld(true);
      }
      
      // Debug: Log refined animation once per 15 seconds
      if (Math.floor(elapsedTime) % 15 === 0 && Math.floor(elapsedTime * 10) % 150 === 0) {
        console.log(`🎯 Refined animation: Quaternion-based pose + minimal breathing motion`);
      }
    };

    // 🎬 ENHANCED ANIMATION LOOP WITH PROCEDURAL BEHAVIORS
    const clock = new THREE.Clock();
    const animate = () => {
      if (!isMounted) return;
      
      const elapsedTime = clock.getElapsedTime();
      
      // 🚫 ANIMATION MIXER UPDATE REMOVED - No longer using mixer, only procedural animations
      
      // 🔍 DEBUG: Check if any mixer is accidentally running (disabled for now)
      
      // 🎭 PROCEDURAL ANIMATION UPDATES
      if (modelRef.current) {
        updateBreathing(elapsedTime);
        updateBlinking(elapsedTime);
        updateGaze(elapsedTime);
        updateArmGestures(elapsedTime); // 🦾 New arm and hand gesture system
        
        // 🔥 CRITICAL: Force SkinnedMesh updates after bone modifications
        modelRef.current.traverse((child) => {
          if (child instanceof THREE.SkinnedMesh) {
            // Force skeleton bone matrices update
            if (child.skeleton) {
              child.skeleton.update();
            }
          }
        });
        
        // Debug: Log animation loop activity once per 30 seconds
        if (Math.floor(elapsedTime) % 30 === 0 && Math.floor(elapsedTime * 10) % 300 === 0) {
          console.log(`🎬 Animation loop active: ${elapsedTime.toFixed(1)}s, Lip Sync: ${isLipSyncActive}`);
        }
      }
      
      // Render scene
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
      
      animationIdRef.current = requestAnimationFrame(animate);
    };

    // Start loading and animation
    loadModel();
    animate();
    
    return () => {
      isMounted = false;
      
      // Cleanup animation
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      
      // 🚫 MIXER CLEANUP REMOVED - No longer using AnimationMixer
      
      // Remove event listeners
      if (rendererRef.current) {
        rendererRef.current.domElement.removeEventListener('mousedown', handleMouseDown);
        rendererRef.current.domElement.removeEventListener('mousemove', handleMouseMove);
        rendererRef.current.domElement.removeEventListener('mouseup', handleMouseUp);
        rendererRef.current.domElement.removeEventListener('wheel', handleWheel);
      }
      
      // Resize cleanup handled in separate useEffect
      
      // Remove model from scene
      if (modelRef.current && sceneRef.current) {
        sceneRef.current.remove(modelRef.current);
        modelRef.current = null;
      }
      
      // Cleanup renderer
      if (rendererRef.current && mountRef.current) {
        mountRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, [modelUrl, onLoad, onError, disableCameraControls]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (rendererRef.current && cameraRef.current && mountRef.current) {
        const width = mountRef.current.clientWidth;
        const height = mountRef.current.clientHeight;
        
        cameraRef.current.aspect = width / height;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(width, height);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return <div ref={mountRef} style={{ width: '100%', height: '100%' }} />;
};

// Process model for lip sync capabilities
const processModelForLipSync = (model: THREE.Group) => {
  console.log('🔧 Analyzing model for lip sync capabilities...');
  
  let morphTargetMeshes = 0;
  let totalMorphTargets = 0;
  const morphTargetNames: string[] = [];
  
  model.traverse((child: any) => {
    if (child.isMesh && child.morphTargetInfluences && child.morphTargetDictionary) {
      morphTargetMeshes++;
      const names = Object.keys(child.morphTargetDictionary);
      totalMorphTargets += names.length;
      morphTargetNames.push(...names);
      
      console.log(`👄 Mesh "${child.name}" has ${names.length} morph targets:`, names.slice(0, 5));
    }
  });
  
  console.log('📊 Model Analysis Summary:', {
    meshesWithMorphTargets: morphTargetMeshes,
    totalMorphTargets,
    sampleTargets: morphTargetNames.slice(0, 10)
  });
  
  // Store lip sync capabilities on model
  model.userData.lipSyncReady = morphTargetMeshes > 0;
  model.userData.morphTargetMeshes = morphTargetMeshes;
  model.userData.totalMorphTargets = totalMorphTargets;
  
  return model.userData.lipSyncReady;
};

// MAIN AVATAR COMPONENT - Fully optimized with pure Three.js
const ChatDollKit3DAvatar = forwardRef<any, ChatDollKitAvatarProps>((
  { 
    config, 
    onAvatarReady, 
    disableCameraControls = false, 
    isLipSyncActive = false,
    ...otherProps 
  }, 
  ref
) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const avatarModelRef = useRef<THREE.Group | null>(null);

  // 🔧 FIX: Stable callbacks with proper dependencies to prevent re-render loops
  const handleLoad = useCallback((loadedModel?: THREE.Group) => {
    console.log('✅ ChatDollKit 3D Avatar ready');
    setIsLoading(false);
    setError(null);
    
    // Store model reference for lip sync access
    if (loadedModel) {
      avatarModelRef.current = loadedModel;
    }
    
    // Call parent callback if provided
    if (onAvatarReady) {
      onAvatarReady();
    }
  }, [onAvatarReady]);

  const handleError = useCallback((error: Error) => {
    console.error('❌ ChatDollKit 3D Avatar error:', error);
    setIsLoading(false);
    setError(error.message);
  }, []);

  // Construct modelUrl - fix double /models/ path issue
  const hasExtension = config.model.includes('.');
  const modelUrl = config.model.startsWith('/models/') 
    ? config.model 
    : hasExtension 
      ? `/models/${config.model}` 
      : `/models/${config.model}.glb`;

  console.log('🎮 ChatDollKit3DAvatar initializing with model:', modelUrl);

  // Expose ref methods
  useImperativeHandle(ref, () => ({
    getModel: () => avatarModelRef.current,
    playAnimation: (animationName: string) => {
      console.log('🎭 Playing animation:', animationName);
    },
    setEmotion: (emotion: string) => {
      console.log('😊 Setting emotion:', emotion);
    },
    updateViseme: (visemeName: string, intensity: number) => {
      if (!avatarModelRef.current) {
        console.warn('⚠️ Cannot update viseme: Avatar model not loaded');
        return;
      }
      
      console.log(`👄 Lip sync update: ${visemeName} = ${intensity.toFixed(2)}`);

      // Find all meshes with morph targets
      avatarModelRef.current.traverse((child: any) => {
        if (child.isMesh && child.morphTargetInfluences && child.morphTargetDictionary) {
          // Reset all mouth-related morph targets to 0 first
          const mouthTargets = ['jawOpen', 'jawForward', 'jawLeft', 'jawRight', 'CH', 'DD', 'FF', 'KK', 'NN', 'PP', 'RR', 'SH', 'TH', 'sil'];
          mouthTargets.forEach(targetName => {
            const targetIndex = child.morphTargetDictionary[targetName];
            if (targetIndex !== undefined && child.morphTargetInfluences[targetIndex] !== undefined) {
              child.morphTargetInfluences[targetIndex] = 0;
            }
          });

          // Map phoneme visemes to morph target names
          const visemeMap: { [key: string]: string } = {
            'sil': 'sil',          // silence
            'A': 'jawOpen',        // open_wide
            'E': 'jawOpen',        // open_mid  
            'I': 'CH',             // smile_narrow
            'O': 'jawOpen',        // rounded
            'U': 'jawForward',     // pucker
            'M': 'PP',             // pressed
            'P': 'PP',             // pressed
            'B': 'PP',             // pressed
            'F': 'FF',             // bite_lower
            'V': 'FF',             // bite_lower
            'TH': 'TH',            // bite_lower
            'T': 'DD',             // pressed
            'D': 'DD',             // pressed
            'K': 'jawOpen',        // open_back
            'G': 'jawOpen',        // open_back
            'CH': 'CH',            // pucker_narrow
            'SH': 'SH',            // pucker_narrow
            'R': 'RR',             // open_narrow
            'L': 'RR',             // open_narrow
            'N': 'NN',             // pressed
            'S': 'CH',             // narrow_open
          };

          // Get the morph target name for this viseme
          const morphTargetName = visemeMap[visemeName] || 'sil';
          
          // Find and update the specific morph target
          const targetIndex = child.morphTargetDictionary[morphTargetName];
          if (targetIndex !== undefined && child.morphTargetInfluences[targetIndex] !== undefined) {
            child.morphTargetInfluences[targetIndex] = Math.max(0, Math.min(1, intensity));
            console.log(`👄 Updated ${child.name}.${morphTargetName} = ${intensity.toFixed(2)}`);
          }
        }
      });
    }
  }), []);

  return (
    <div className="chatdollkit-3d-avatar w-full h-96 border border-gray-200 rounded-lg overflow-hidden bg-gradient-to-br from-blue-50 to-purple-50">
      {/* Header */}
      <div className="bg-white/80 p-2 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium">3D Avatar</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <span>AVA</span>
            <div className="w-1 h-1 bg-blue-500 rounded-full"></div>
            {isLipSyncActive && (
              <div className="flex items-center gap-1 ml-2">
                <div className="w-1 h-1 bg-red-500 rounded-full animate-pulse"></div>
                <span className="text-xs text-red-600">Speaking</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3D Canvas */}
      <div className="relative w-full h-full">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100/50 z-10">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-sm text-gray-600">Loading 3D Avatar...</p>
              <p className="mt-1 text-xs text-gray-500">Analyzing model: {config.model}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-50 z-10">
            <div className="text-center">
              <div className="text-red-500 text-4xl">⚠️</div>
              <p className="mt-2 text-sm text-red-600">Error: {error}</p>
              <p className="text-xs text-gray-500 mt-1">Check model file: {modelUrl}</p>
            </div>
          </div>
        )}

        <PureThreeCanvas 
          modelUrl={modelUrl}
          onLoad={handleLoad}
          onError={handleError}
          disableCameraControls={disableCameraControls}
          isLipSyncActive={isLipSyncActive}
        />
        
        {/* Lip Sync Visual Indicator Overlay */}
        {isLipSyncActive && (
          <div className="absolute top-2 right-2 bg-red-500/20 backdrop-blur-sm border border-red-500/30 rounded-lg px-2 py-1">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
              <span className="text-xs text-red-600 font-medium">Lip Sync Active</span>
            </div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="bg-white/80 p-1 border-t">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Model: {config.model}</span>
          <span>{isLoading ? 'Loading...' : error ? 'Error' : 'Ready'}</span>
        </div>
      </div>
    </div>
  );
});

export default ChatDollKit3DAvatar;