/**
 * DS Action Tracker - Complete with Manipulate and Defensive Actions
 */

Hooks.once('init', async function() {
  console.log("DS Action Tracker | ✅ INIT HOOK FIRED");
});

Hooks.once('ready', async function() {
  console.log("DS Action Tracker | ✅ READY HOOK FIRED");
  
  if (game.system.id !== "pf2e") {
    console.error("DS Action Tracker | ❌ WRONG SYSTEM");
    return;
  }
  
  console.log("DS Action Tracker | ✅ PF2e SYSTEM DETECTED");
  initializeTracker();
});

// Store action counts for each token
const actionCounts = new Map();

// Track current combat state
let currentCombatState = {
  round: 0,
  turn: 0
};

// Track recent actions to avoid duplicates
const recentActions = new Set();

// Track attack counts for MAP (Multi-Attack Penalty)
const attackCounts = new Map();

function initializeTracker() {
  console.log("DS Action Tracker | 🚀 INITIALIZING TRACKER");
  
  // Initialize combat state if combat exists
  if (game.combat) {
    currentCombatState.round = game.combat.round;
    currentCombatState.turn = game.combat.turn;
  }
  
  // Handle existing controlled tokens
  canvas.tokens.controlled.forEach(token => {
    console.log("DS Action Tracker | Found pre-controlled token:", token.name);
    initializeTokenActions(token);
    createTokenBubble(token);
  });
  
  // Listen for selection changes
  Hooks.on('controlToken', (token, controlled) => {
    console.log(`DS Action Tracker | CONTROL HOOK: ${token.name} ${controlled ? 'controlled' : 'released'}`);
    
    if (controlled) {
      initializeTokenActions(token);
      createTokenBubble(token);
    } else {
      removeTokenBubble(token);
    }
  });

  // Listen for combat tracker updates to reset actions
  Hooks.on('updateCombat', (combat, update, options, userId) => {
    handleCombatUpdate(combat, update);
  });

  // METHOD 1: Direct approach - override token's action methods
  overrideTokenActions();
  
  // METHOD 2: Listen for any button clicks that might be actions
  Hooks.on('renderActorSheet', (app, html, data) => {
    setupActionButtonListeners(app, html, data);
  });

  // METHOD 3: Listen for chat messages as fallback
  Hooks.on('createChatMessage', (message) => {
    trackActionsFromMessage(message);
  });

  // METHOD 4: Listen for any dialog that might be action-related
  Hooks.on('renderDialog', (dialog, html, data) => {
    trackActionsFromDialog(dialog, html, data);
  });

  // METHOD 5: Listen for measured template creation (spells/abilities)
  Hooks.on('createMeasuredTemplate', (template) => {
    trackActionsFromTemplate(template);
  });

  // METHOD 6: Specific MAP detection for attack sequences
  setupMAPDetection();

  // METHOD 7: Listen for inventory/equipment changes (sheathe, draw, drop, pickup)
  setupInventoryActionDetection();

  console.log("DS Action Tracker | ✅ ALL HOOKS REGISTERED");
}

// METHOD 7: Inventory action detection
function setupInventoryActionDetection() {
  console.log("DS Action Tracker | 🔧 Setting up inventory action detection");
  
  // Override inventory-related methods
  const originalUpdateActor = CONFIG.Actor.documentClass.prototype.update;
  CONFIG.Actor.documentClass.prototype.update = function(updateData, options = {}) {
    // Check for inventory changes that cost actions
    if (updateData.system?.inventory && canvas.tokens.controlled.length > 0) {
      const token = canvas.tokens.controlled[0];
      const counts = actionCounts.get(token.id);
      
      // Look for equipment changes that should cost actions
      const hasEquipmentChange = Object.keys(updateData.system.inventory).some(key => {
        const itemData = updateData.system.inventory[key];
        return itemData?.equipped !== undefined || itemData?.quantity !== undefined;
      });
      
      if (counts && hasEquipmentChange && counts.full > 0 && game.combat?.started) {
        // Check if this is a significant equipment change (not just quantity adjustment)
        const isActionWorthyChange = Object.keys(updateData.system.inventory).some(key => {
          const itemData = updateData.system.inventory[key];
          // Changing equipped status or dropping/picking up items costs actions
          return itemData?.equipped !== undefined;
        });
        
        if (isActionWorthyChange) {
          counts.full -= 1;
          updateBubbleDisplay(token);
          console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} for inventory change`);
        }
      }
    }
    
    return originalUpdateActor.call(this, updateData, options);
  };

  // Listen for specific inventory button clicks
  Hooks.on('renderActorSheet', (app, html, data) => {
    // Listen for equip/unequip, drop, take, sheathe, draw buttons
    html.on('click', '[data-action="equip"], [data-action="unequip"], [data-action="drop"], [data-action="take"], [data-action="sheathe"], [data-action="draw"], [data-action="toggle-equipped"]', (event) => {
      setTimeout(() => {
        if (canvas.tokens.controlled.length > 0 && game.combat?.started) {
          const token = canvas.tokens.controlled[0];
          const counts = actionCounts.get(token.id);
          const button = event.currentTarget;
          const actionType = button.dataset.action;
          
          if (counts && counts.full > 0) {
            counts.full -= 1;
            updateBubbleDisplay(token);
            console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} for ${actionType} action`);
          }
        }
      }, 100);
    });
  });
}

// METHOD 6: Specific MAP detection for attack sequences
function setupMAPDetection() {
  console.log("DS Action Tracker | 🔧 Setting up MAP detection");
  
  // Listen for specific attack buttons that indicate MAP
  Hooks.on('renderActorSheet', (app, html, data) => {
    // Look for MAP-specific buttons (second, third attack buttons)
    html.find('button[data-pf2-map], [data-map], [title*="MAP"], [title*="attack"]').each((i, button) => {
      const buttonText = button.textContent?.toLowerCase() || '';
      const buttonTitle = button.title?.toLowerCase() || '';
      
      // Check if this is a MAP attack button
      const isMAPButton = buttonText.includes('second') || 
                         buttonText.includes('third') ||
                         buttonText.includes('-5') ||
                         buttonText.includes('-10') ||
                         buttonTitle.includes('map') ||
                         buttonTitle.includes('second') ||
                         buttonTitle.includes('third');
      
      if (isMAPButton) {
        $(button).on('click', (event) => {
          setTimeout(() => {
            if (canvas.tokens.controlled.length > 0) {
              const token = canvas.tokens.controlled[0];
              const counts = actionCounts.get(token.id);
              
              if (counts && counts.full > 0) {
                counts.full -= 1;
                updateBubbleDisplay(token);
                console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} for MAP attack: ${buttonText}`);
              }
            }
          }, 100);
        });
      }
    });
  });
}

// METHOD 1: Direct override of action execution - ENHANCED
function overrideTokenActions() {
  console.log("DS Action Tracker | 🔧 Overriding action methods");
  
  // Store original method
  const originalRollAction = CONFIG.Actor.documentClass.prototype.rollAction;
  
  // Override rollAction method - ENHANCED with more action types
  CONFIG.Actor.documentClass.prototype.rollAction = function(...args) {
    console.log("DS Action Tracker | 🎯 rollAction called:", args);
    
    // Check if this is part of an attack sequence for MAP
    const actionName = args[0]?.name || '';
    const isAttack = actionName.toLowerCase().includes('strike') || 
                    actionName.toLowerCase().includes('attack');
    
    // Check for manipulate actions
    const isManipulate = actionName.toLowerCase().includes('sheathe') ||
                        actionName.toLowerCase().includes('draw') ||
                        actionName.toLowerCase().includes('pick') ||
                        actionName.toLowerCase().includes('drop') ||
                        actionName.toLowerCase().includes('take');
    
    // Check for defensive actions
    const isDefensive = actionName.toLowerCase().includes('parry') ||
                       actionName.toLowerCase().includes('raise') ||
                       actionName.toLowerCase().includes('cover') ||
                       actionName.toLowerCase().includes('shield');
    
    if (canvas.tokens.controlled.length > 0) {
      const token = canvas.tokens.controlled[0];
      const tokenId = token.id;
      const counts = actionCounts.get(tokenId);
      
      if (counts && counts.full > 0) {
        // For attacks, track the sequence for MAP
        if (isAttack) {
          const currentAttackCount = attackCounts.get(tokenId) || 0;
          attackCounts.set(tokenId, currentAttackCount + 1);
          console.log(`DS Action Tracker | 🎯 Attack #${currentAttackCount + 1} for ${token.name}`);
        }
        
        counts.full -= 1;
        updateBubbleDisplay(token);
        
        if (isManipulate) {
          console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} for manipulate action: ${actionName}`);
        } else if (isDefensive) {
          console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} for defensive action: ${actionName}`);
        } else {
          console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} via rollAction: ${actionName}`);
        }
      }
    }
    
    return originalRollAction.apply(this, args);
  };

  // Also override skill checks and ability checks
  const originalRollSkill = CONFIG.Actor.documentClass.prototype.rollSkill;
  CONFIG.Actor.documentClass.prototype.rollSkill = function(...args) {
    console.log("DS Action Tracker | 🎯 rollSkill called:", args);
    
    if (game.combat?.started && canvas.tokens.controlled.length > 0) {
      const token = canvas.tokens.controlled[0];
      const counts = actionCounts.get(token.id);
      if (counts && counts.full > 0) {
        counts.full -= 1;
        updateBubbleDisplay(token);
        console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} via rollSkill`);
      }
    }
    
    return originalRollSkill.apply(this, args);
  };

  // Override item rolls (attacks, spells) - ENHANCED
  const originalRollItem = CONFIG.Item.documentClass.prototype.roll;
  CONFIG.Item.documentClass.prototype.roll = function(...args) {
    console.log("DS Action Tracker | 🎯 Item roll called:", this.name, this);
    
    if (canvas.tokens.controlled.length > 0) {
      const token = canvas.tokens.controlled[0];
      const tokenId = token.id;
      const counts = actionCounts.get(tokenId);
      
      // Check if this is an action-based item
      const isAction = this.system?.actionType || 
                      this.system?.traits?.value?.includes('action') ||
                      this.name?.toLowerCase().includes('strike') ||
                      this.type === 'spell';
      
      // Check if this is an attack for MAP tracking
      const isAttack = this.name?.toLowerCase().includes('strike') || 
                      this.system?.actionType === 'action' ||
                      this.system?.traits?.value?.includes('attack');
      
      // Check for manipulate actions via items
      const isManipulateItem = this.name?.toLowerCase().includes('sheathe') ||
                              this.name?.toLowerCase().includes('draw') ||
                              this.name?.toLowerCase().includes('parry');
      
      if (counts && (isAction || isManipulateItem) && counts.full > 0) {
        // For attacks, track the sequence for MAP
        if (isAttack) {
          const currentAttackCount = attackCounts.get(tokenId) || 0;
          attackCounts.set(tokenId, currentAttackCount + 1);
          console.log(`DS Action Tracker | 🎯 Attack #${currentAttackCount + 1} for ${token.name}: ${this.name}`);
        }
        
        counts.full -= 1;
        updateBubbleDisplay(token);
        
        if (isManipulateItem) {
          console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} for item manipulate action: ${this.name}`);
        } else {
          console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} for ${this.name}`);
        }
      }
    }
    
    return originalRollItem.apply(this, args);
  };
}

// METHOD 2: Listen for action button clicks with enhanced detection
function setupActionButtonListeners(app, html, data) {
  console.log("DS Action Tracker | 🔧 Setting up action button listeners");
  
  // Listen for clicks on action buttons - ENHANCED with more action types
  html.on('click', '[data-action="roll"], [data-action="use"], button[data-action]', (event) => {
    setTimeout(() => {
      if (canvas.tokens.controlled.length > 0) {
        const token = canvas.tokens.controlled[0];
        const tokenId = token.id;
        const counts = actionCounts.get(tokenId);
        
        // Check if this is likely an action button
        const button = event.currentTarget;
        const buttonText = button.textContent?.toLowerCase() || '';
        const buttonTitle = button.title?.toLowerCase() || '';
        const isActionButton = buttonText.includes('strike') || 
                              buttonText.includes('attack') ||
                              buttonText.includes('cast') ||
                              buttonText.includes('skill') ||
                              button.dataset.action === 'roll' ||
                              button.dataset.action === 'use';
        
        // Enhanced MAP detection for attack buttons
        const isMAPAttack = buttonText.includes('second') || 
                           buttonText.includes('third') ||
                           buttonText.includes('-5') ||
                           buttonText.includes('-10') ||
                           buttonTitle.includes('map') ||
                           buttonTitle.includes('second') ||
                           buttonTitle.includes('third');
        
        // Detect manipulate and defensive actions
        const isManipulateAction = buttonText.includes('sheathe') ||
                                  buttonText.includes('draw') ||
                                  buttonText.includes('pick') ||
                                  buttonText.includes('drop') ||
                                  buttonText.includes('take');
        
        const isDefensiveAction = buttonText.includes('parry') ||
                                 buttonText.includes('raise') ||
                                 buttonText.includes('cover') ||
                                 buttonText.includes('shield');
        
        if (counts && (isActionButton || isMAPAttack || isManipulateAction || isDefensiveAction) && counts.full > 0) {
          // Track attacks for MAP
          if (isMAPAttack || buttonText.includes('strike') || buttonText.includes('attack')) {
            const currentAttackCount = attackCounts.get(tokenId) || 0;
            attackCounts.set(tokenId, currentAttackCount + 1);
            console.log(`DS Action Tracker | 🎯 Attack #${currentAttackCount + 1} for ${token.name} via button`);
          }
          
          counts.full -= 1;
          updateBubbleDisplay(token);
          
          if (isManipulateAction) {
            console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} for manipulate action: ${buttonText}`);
          } else if (isDefensiveAction) {
            console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} for defensive action: ${buttonText}`);
          } else {
            console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} via button: ${buttonText}`);
          }
        }
      }
    }, 100);
  });
}

// METHOD 3: Dialog-based action detection with enhanced support
function trackActionsFromDialog(dialog, html, data) {
  if (!canvas.tokens.controlled.length) return;
  
  const token = canvas.tokens.controlled[0];
  const tokenId = token.id;
  const counts = actionCounts.get(tokenId);
  
  if (!counts) return;
  
  const dialogName = dialog.constructor.name;
  console.log("DS Action Tracker | 🎯 Dialog Opened:", dialogName, dialog.title);
  
  // Check if this is an action-related dialog - ENHANCED with more types
  const isActionDialog = 
    dialogName === 'CheckModifiersDialog' ||
    dialogName.includes('Action') ||
    (dialog.title && (
      dialog.title.includes('Strike') ||
      dialog.title.includes('Attack') ||
      dialog.title.includes('Cast') ||
      dialog.title.includes('Skill') ||
      dialog.title.includes('Check') ||
      dialog.title.includes('Sheathe') ||
      dialog.title.includes('Draw') ||
      dialog.title.includes('Parry') ||
      dialog.title.includes('Raise') ||
      dialog.title.includes('Cover')
    ));
  
  if (isActionDialog) {
    // Enhanced: Look for MAP indicators and other action types in the dialog
    const dialogContent = html.text().toLowerCase();
    const hasMAP = dialogContent.includes('second') || 
                  dialogContent.includes('third') ||
                  dialogContent.includes('-5') ||
                  dialogContent.includes('-10') ||
                  dialogContent.includes('map');
    
    const hasManipulate = dialogContent.includes('sheathe') ||
                         dialogContent.includes('draw') ||
                         dialogContent.includes('pick') ||
                         dialogContent.includes('drop') ||
                         dialogContent.includes('take');
    
    const hasDefensive = dialogContent.includes('parry') ||
                        dialogContent.includes('raise') ||
                        dialogContent.includes('cover') ||
                        dialogContent.includes('shield');
    
    // Listen for the dialog submission
    const form = html.find('form')[0];
    if (form) {
      const originalSubmit = form.onsubmit;
      form.onsubmit = function(event) {
        console.log("DS Action Tracker | 🎯 Action Dialog Submitted");
        if (counts.full > 0) {
          // Track attacks for MAP
          if (hasMAP || dialogContent.includes('attack') || dialogContent.includes('strike')) {
            const currentAttackCount = attackCounts.get(tokenId) || 0;
            attackCounts.set(tokenId, currentAttackCount + 1);
            console.log(`DS Action Tracker | 🎯 Attack #${currentAttackCount + 1} for ${token.name} via dialog`);
          }
          
          counts.full -= 1;
          updateBubbleDisplay(token);
          
          if (hasManipulate) {
            console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} for manipulate action via dialog`);
          } else if (hasDefensive) {
            console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} for defensive action via dialog`);
          } else {
            console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} via dialog submission`);
          }
        }
        return originalSubmit?.call(this, event);
      };
    }
    
    // Also listen for roll buttons
    html.find('button[type="submit"], [data-action="roll"]').on('click', () => {
      console.log("DS Action Tracker | 🎯 Dialog Roll Button Clicked");
      if (counts.full > 0) {
        // Track attacks for MAP
        if (hasMAP || dialogContent.includes('attack') || dialogContent.includes('strike')) {
          const currentAttackCount = attackCounts.get(tokenId) || 0;
          attackCounts.set(tokenId, currentAttackCount + 1);
          console.log(`DS Action Tracker | 🎯 Attack #${currentAttackCount + 1} for ${token.name} via dialog button`);
        }
        
        counts.full -= 1;
        updateBubbleDisplay(token);
        
        if (hasManipulate) {
          console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} for manipulate action via dialog button`);
        } else if (hasDefensive) {
          console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} for defensive action via dialog button`);
        } else {
          console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} via dialog button`);
        }
      }
    });
  }
}

// [REST OF THE METHODS AND FUNCTIONS REMAIN THE SAME - trackActionsFromMessage, trackActionsFromTemplate, handleCombatUpdate, resetTokenActions, initializeTokenActions, and all bubble functions]

// METHOD 4: Chat message fallback
function trackActionsFromMessage(message) {
  if (!message.author?.active) return;
  
  console.log("DS Action Tracker | 📨 Chat message received");
  
  const content = message.content;
  
  // Check for action cost in message flags
  let actionCost = null;
  if (message.flags?.pf2e?.actionCost) {
    actionCost = message.flags.pf2e.actionCost;
    console.log("DS Action Tracker | 🔍 Found action cost in flags:", actionCost);
  }
  
  // Count action icons
  const singleActions = (content.match(/<span class="action-glyph">1<\/span>/g) || []).length;
  const twoActions = (content.match(/<span class="action-glyph">2<\/span>/g) || []).length;
  const threeActions = (content.match(/<span class="action-glyph">3<\/span>/g) || []).length;
  const reactions = (content.match(/<span class="action-glyph">R<\/span>/g) || []).length;
  
  console.log("DS Action Tracker | 🔍 Action counts - Single:", singleActions, "Two:", twoActions, "Three:", threeActions, "Reactions:", reactions);

  // Find which token this message came from
  let targetToken = null;
  
  if (message.author.id === game.user.id) {
    const userTokens = canvas.tokens.controlled;
    if (userTokens.length > 0) {
      targetToken = userTokens[0];
    }
  }
  
  if (targetToken) {
    const tokenId = targetToken.id;
    const counts = actionCounts.get(tokenId);
    
    if (counts) {
      // Use action cost from flags
      if (actionCost) {
        if (actionCost.type === "action" && actionCost.value) {
          counts.full -= actionCost.value;
          console.log(`DS Action Tracker | ➖ Deducted ${actionCost.value} action(s) from ${targetToken.name} via flags`);
        } else if (actionCost.type === "reaction") {
          counts.reaction -= 1;
          console.log(`DS Action Tracker | ➖ Deducted 1 reaction from ${targetToken.name} via flags`);
        }
      }
      // Use detected action symbols
      else if (singleActions > 0 || twoActions > 0 || threeActions > 0 || reactions > 0) {
        const totalActions = singleActions + (twoActions * 2) + (threeActions * 3);
        if (totalActions > 0) {
          counts.full -= totalActions;
          console.log(`DS Action Tracker | ➖ Deducted ${totalActions} action(s) from ${targetToken.name} via icons`);
        }
        if (reactions > 0) {
          counts.reaction -= reactions;
          console.log(`DS Action Tracker | ➖ Deducted ${reactions} reaction(s) from ${targetToken.name} via icons`);
        }
      }
      
      // Ensure counts don't go negative
      counts.full = Math.max(0, counts.full);
      counts.reaction = Math.max(0, counts.reaction);
      
      updateBubbleDisplay(targetToken);
      console.log(`DS Action Tracker | 📊 Updated actions for ${targetToken.name}:`, counts);
    }
  }
}

// METHOD 5: Template-based detection for spells/abilities
function trackActionsFromTemplate(template) {
  if (!canvas.tokens.controlled.length) return;
  
  const token = canvas.tokens.controlled[0];
  const tokenId = token.id;
  const counts = actionCounts.get(tokenId);
  
  if (!counts) return;
  
  console.log("DS Action Tracker | 🎯 Template Created:", template);
  
  // Templates for spells or abilities usually indicate an action was used
  if (counts.full > 0) {
    counts.full -= 1;
    updateBubbleDisplay(token);
    console.log(`DS Action Tracker | ➖ Deducted 1 action from ${token.name} for template creation`);
  }
}

function handleCombatUpdate(combat, update) {
  console.log("DS Action Tracker | ⚔️ Combat updated:", update);
  
  // Detect new round
  const isNewRound = update.round !== undefined && update.round > currentCombatState.round;
  const isRoundReset = update.turn === 0 && currentCombatState.turn !== 0;
  
  if (isNewRound || isRoundReset) {
    console.log("DS Action Tracker | 🔄 NEW ROUND DETECTED - Resetting actions for ALL combatants");
    
    // Reset actions for ALL combatants
    if (combat && combat.combatants) {
      combat.combatants.forEach(combatant => {
        if (combatant.tokenId) {
          const token = canvas.tokens.get(combatant.tokenId);
          if (token) {
            resetTokenActions(token);
          } else {
            const tokenId = combatant.tokenId;
            if (!actionCounts.has(tokenId)) {
              actionCounts.set(tokenId, {
                full: 3,
                quick: 0,
                reaction: 1
              });
            } else {
              const counts = actionCounts.get(tokenId);
              counts.full = 3;
              counts.quick = 0;
              counts.reaction = 1;
            }
          }
        }
      });
    }
    
    // Also reset controlled tokens and attack counts
    canvas.tokens.controlled.forEach(token => {
      if (!actionCounts.has(token.id)) {
        resetTokenActions(token);
      }
      // Reset attack counts for MAP tracking
      attackCounts.set(token.id, 0);
    });
  }
  
  // Update current combat state
  if (update.round !== undefined) currentCombatState.round = update.round;
  if (update.turn !== undefined) currentCombatState.turn = update.turn;
}

function resetTokenActions(token) {
  const tokenId = token.id;
  if (!actionCounts.has(tokenId)) {
    actionCounts.set(tokenId, {
      full: 3,
      quick: 0,
      reaction: 1
    });
  } else {
    const counts = actionCounts.get(tokenId);
    counts.full = 3;
    counts.quick = 0;
    counts.reaction = 1;
  }
  
  // Reset attack count for MAP tracking
  attackCounts.set(tokenId, 0);
  
  if (canvas.tokens.controlled.some(t => t.id === tokenId)) {
    updateBubbleDisplay(token);
  }
  
  console.log("DS Action Tracker | 🔄 Actions reset for:", token.name, actionCounts.get(tokenId));
}

function initializeTokenActions(token) {
  const tokenId = token.id;
  if (!actionCounts.has(tokenId)) {
    actionCounts.set(tokenId, {
      full: 3,
      quick: 0,
      reaction: 1
    });
    console.log("DS Action Tracker | 🎯 Initialized NEW actions for:", token.name, actionCounts.get(tokenId));
  } else {
    console.log("DS Action Tracker | 💾 Using EXISTING actions for:", token.name, actionCounts.get(tokenId));
  }
  
  // Initialize attack count for MAP tracking
  attackCounts.set(tokenId, 0);
}

// [REST OF BUBBLE FUNCTIONS REMAIN EXACTLY THE SAME - createTokenBubble, adjustCounter, updateBubbleDisplay, etc.]
// Check if user has permission to adjust counters
function canAdjustCounters() {
  return game.user.isGM || game.user.role >= CONST.USER_ROLES.ASSISTANT;
}

function createTokenBubble(token) {
  const tokenId = token.id;
  
  // Remove any existing bubble first
  const existingBubble = document.getElementById(`ds-tracker-${tokenId}`);
  if (existingBubble) {
    existingBubble.remove();
  }
  
  console.log("DS Action Tracker | 🎯 CREATING BUBBLE FOR:", token.name);
  
  const bubble = document.createElement('div');
  bubble.id = `ds-tracker-${tokenId}`;
  
  const canAdjust = canAdjustCounters();
  const adjustStyle = canAdjust ? 'cursor: pointer;' : '';
  const adjustTitle = canAdjust ? 'title="Click to adjust"' : '';
  
  // Get current counts for this token
  const counts = actionCounts.get(tokenId) || { full: 3, quick: 0, reaction: 1 };
  
  // BUBBLE WITH 3 COUNTERS + CLICK-TO-ADJUST
  bubble.innerHTML = `
    <div id="ds-tracker-${tokenId}-handle" style="
      background: linear-gradient(135deg, #1a472a, #2d5a3a); 
      color: white; 
      padding: 8px 12px; 
      border: 2px solid #4ade80; 
      border-radius: 8px;
      font-size: 12px; 
      font-weight: bold; 
      position: fixed; 
      bottom: 120px; 
      left: 50px; 
      z-index: 100;
      box-shadow: 0 4px 12px rgba(0,0,0,0.8);
      min-width: 275px;
      text-align: center;
      font-family: Arial, sans-serif;
      cursor: move;
      user-select: none;
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 6px;">
        <div style="display: flex; flex-direction: column; align-items: center; flex: 1;">
          <div id="action-counter-${tokenId}" 
               style="font-size: 18px; line-height: 1; color: #86efac; ${adjustStyle}" 
               ${adjustTitle}>
            ${counts.full}
          </div>
          <div style="font-size: 9px; opacity: 0.9;">ACTIONS</div>
          ${canAdjust ? `
            <div style="display: flex; gap: 2px; margin-top: 2px;">
              <button id="action-minus-${tokenId}" style="background: #dc2626; color: white; border: none; border-radius: 2px; width: 14px; height: 14px; cursor: pointer; font-size: 8px; line-height: 1;">-</button>
              <button id="action-plus-${tokenId}" style="background: #16a34a; color: white; border: none; border-radius: 2px; width: 14px; height: 14px; cursor: pointer; font-size: 8px; line-height: 1;">+</button>
            </div>
          ` : ''}
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; flex: 1;">
          <div id="quick-counter-${tokenId}" 
               style="font-size: 18px; line-height: 1; color: #fbbf24; ${adjustStyle}" 
               ${adjustTitle}>
            ${counts.quick}
          </div>
          <div style="font-size: 9px; opacity: 0.9;">QUICK</div>
          ${canAdjust ? `
            <div style="display: flex; gap: 2px; margin-top: 2px;">
              <button id="quick-minus-${tokenId}" style="background: #dc2626; color: white; border: none; border-radius: 2px; width: 14px; height: 14px; cursor: pointer; font-size: 8px; line-height: 1;">-</button>
              <button id="quick-plus-${tokenId}" style="background: #16a34a; color: white; border: none; border-radius: 2px; width: 14px; height: 14px; cursor: pointer; font-size: 8px; line-height: 1;">+</button>
            </div>
          ` : ''}
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; flex: 1;">
          <div id="reaction-counter-${tokenId}" 
               style="font-size: 18px; line-height: 1; color: #86efac; ${adjustStyle}" 
               ${adjustTitle}>
            ${counts.reaction}
          </div>
          <div style="font-size: 9px; opacity: 0.9;">REACTION</div>
          ${canAdjust ? `
            <div style="display: flex; gap: 2px; margin-top: 2px;">
              <button id="reaction-minus-${tokenId}" style="background: #dc2626; color: white; border: none; border-radius: 2px; width: 14px; height: 14px; cursor: pointer; font-size: 8px; line-height: 1;">-</button>
              <button id="reaction-plus-${tokenId}" style="background: #16a34a; color: white; border: none; border-radius: 2px; width: 14px; height: 14px; cursor: pointer; font-size: 8px; line-height: 1;">+</button>
            </div>
          ` : ''}
        </div>
      </div>
      <div style="border-top: 1px solid #4ade80; padding-top: 6px;">
        <div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px;">${token.name}</div>
        <div style="display: flex; justify-content: center; gap: 6px;">
          ${canAdjust ? `
            <button id="haste-btn-${tokenId}" style="background: linear-gradient(135deg, #f59e0b, #fbbf24); color: black; border: none; padding: 3px 6px; border-radius: 3px; cursor: pointer; font-size: 9px; font-weight: bold;">
              +HASTE
            </button>
            <button id="reset-btn-${tokenId}" style="background: linear-gradient(135deg, #1e40af, #3b82f6); color: white; border: none; padding: 3px 6px; border-radius: 3px; cursor: pointer; font-size: 9px; font-weight: bold;">
              ↻ RESET
            </button>
          ` : ''}
          <button id="close-btn-${tokenId}" style="background: linear-gradient(135deg, #dc2626, #ef4444); color: white; border: none; padding: 3px 10px; border-radius: 3px; cursor: pointer; font-size: 9px; font-weight: bold;">
            ✕ CLOSE
          </button>
        </div>
        <div style="font-size: 8px; opacity: 0.6; margin-top: 4px;">
          ${canAdjust ? 'Click numbers or use +/- • ' : ''}Resets each turn
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(bubble);
  console.log("DS Action Tracker | ✅ BUBBLE CREATED");
  
  // Add event listeners for adjustable counters
  if (canAdjust) {
    // Action counter click
    document.getElementById(`action-counter-${tokenId}`)?.addEventListener('click', () => adjustCounter(tokenId, 'full'));
    
    // Quick counter click  
    document.getElementById(`quick-counter-${tokenId}`)?.addEventListener('click', () => adjustCounter(tokenId, 'quick'));
    
    // Reaction counter click
    document.getElementById(`reaction-counter-${tokenId}`)?.addEventListener('click', () => adjustCounter(tokenId, 'reaction'));
    
    // Action +/- buttons
    document.getElementById(`action-minus-${tokenId}`)?.addEventListener('click', () => adjustActionCount(tokenId, -1));
    document.getElementById(`action-plus-${tokenId}`)?.addEventListener('click', () => adjustActionCount(tokenId, 1));
    
    // Quick +/- buttons
    document.getElementById(`quick-minus-${tokenId}`)?.addEventListener('click', () => adjustQuickCount(tokenId, -1));
    document.getElementById(`quick-plus-${tokenId}`)?.addEventListener('click', () => adjustQuickCount(tokenId, 1));
    
    // Reaction +/- buttons
    document.getElementById(`reaction-minus-${tokenId}`)?.addEventListener('click', () => adjustReactionCount(tokenId, -1));
    document.getElementById(`reaction-plus-${tokenId}`)?.addEventListener('click', () => adjustReactionCount(tokenId, 1));
    
    // Haste button
    document.getElementById(`haste-btn-${tokenId}`)?.addEventListener('click', () => adjustQuickCount(tokenId, 1));
    
    // Reset button
    document.getElementById(`reset-btn-${tokenId}`)?.addEventListener('click', () => resetTokenActions(token));
  }
  
  // Close button (always available)
  document.getElementById(`close-btn-${tokenId}`)?.addEventListener('click', () => {
    console.log("DS Action Tracker | ❌ Close button clicked");
    bubble.remove();
  });
  
  // Make it draggable
  makeDraggable(bubble, `ds-tracker-${tokenId}-handle`);
}

function adjustCounter(tokenId, type) {
  const typeNames = { full: 'actions', quick: 'quick actions', reaction: 'reactions' };
  const current = actionCounts.get(tokenId)?.[type] || (type === 'reaction' ? 1 : type === 'quick' ? 0 : 3);
  const newValue = prompt(`Set ${typeNames[type]} for token:`, current);
  if (newValue !== null && !isNaN(newValue)) {
    const counts = actionCounts.get(tokenId);
    if (counts) {
      counts[type] = Math.max(0, parseInt(newValue));
      const token = canvas.tokens?.placeables.find(t => t.id === tokenId);
      if (token) updateBubbleDisplay(token);
      console.log(`DS Action Tracker | ✏️ Manually set ${typeNames[type]} to ${counts[type]}`);
    }
  }
}

function adjustActionCount(tokenId, change) {
  const counts = actionCounts.get(tokenId);
  if (counts) {
    counts.full = Math.max(0, counts.full + change);
    updateBubbleForToken(tokenId);
    console.log(`DS Action Tracker | ${change > 0 ? '➕' : '➖'} Adjusted actions to ${counts.full}`);
  }
}

function adjustQuickCount(tokenId, change) {
  const counts = actionCounts.get(tokenId);
  if (counts) {
    counts.quick = Math.max(0, counts.quick + change);
    updateBubbleForToken(tokenId);
    console.log(`DS Action Tracker | ${change > 0 ? '➕' : '➖'} Adjusted quick actions to ${counts.quick}`);
  }
}

function adjustReactionCount(tokenId, change) {
  const counts = actionCounts.get(tokenId);
  if (counts) {
    counts.reaction = Math.max(0, counts.reaction + change);
    updateBubbleForToken(tokenId);
    console.log(`DS Action Tracker | ${change > 0 ? '➕' : '➖'} Adjusted reactions to ${counts.reaction}`);
  }
}

function updateBubbleForToken(tokenId) {
  const token = canvas.tokens?.placeables.find(t => t.id === tokenId);
  if (token) updateBubbleDisplay(token);
}

function makeDraggable(bubble, handleId) {
  const handle = document.getElementById(handleId);
  if (!handle) return;
  
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  
  handle.onmousedown = dragMouseDown;
  
  function dragMouseDown(e) {
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }
  
  function elementDrag(e) {
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    handle.style.top = (handle.offsetTop - pos2) + "px";
    handle.style.left = (handle.offsetLeft - pos1) + "px";
    handle.style.bottom = "auto";
    handle.style.right = "auto";
  }
  
  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

function updateBubbleDisplay(token) {
  const tokenId = token.id;
  
  setTimeout(() => {
    const bubble = document.getElementById(`ds-tracker-${tokenId}`);
    if (!bubble) return;
    
    const counts = actionCounts.get(tokenId) || { full: 3, quick: 0, reaction: 1 };
    
    const actionElement = document.getElementById(`action-counter-${tokenId}`);
    const quickElement = document.getElementById(`quick-counter-${tokenId}`);
    const reactionElement = document.getElementById(`reaction-counter-${tokenId}`);
    
    if (actionElement) actionElement.textContent = counts.full;
    if (quickElement) quickElement.textContent = counts.quick;
    if (reactionElement) reactionElement.textContent = counts.reaction;
    
    console.log("DS Action Tracker | 🔄 Updated bubble for:", token.name, counts);
  }, 100);
}

function removeTokenBubble(token) {
  const tokenId = token.id;
  const bubble = document.getElementById(`ds-tracker-${tokenId}`);
  if (bubble) {
    bubble.remove();
    console.log("DS Action Tracker | ❌ BUBBLE REMOVED:", token.name);
  }
}