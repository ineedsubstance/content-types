'use strict';

const plugabilly = require('plugabilly');
const merge = require('deepmerge');
const uuid = require('uuid');
const _ = require('lodash');
const slugify = require('lodash/kebabCase');

/*
 * Determine required level
 *
 * @param {string} level - `required` level written in config
 *
 * @returns {string} system-compliant level string
 */
const requiredLevel = (level) => {
  if ((level === true) || (level === 'save') || (level === 2)) {
    return 'save';
  }
  if ((level === 'publish') || (level === 1)) {
    return 'publish';
  }

  return false;
};

/*
 * Combine content types configurations with input plugins
 *
 * @param {array} types - content types configurations
 * @param {object} config - configuration object
 *
 * @returns {promise} - combined content type with input plugin configs
 */
const squish = (types, config) => {
  const configPlugins = {};
  configPlugins.search = _.get(config, 'content.plugins.directory', []);
  if (typeof configPlugins.search === 'string') {
    configPlugins.search = [configPlugins.search];
  }

  const plugins = plugabilly(_.cloneDeep(configPlugins)).name().containsSync('input-plugin-');

  return new Promise((resolve, reject) => {
    if (!Array.isArray(types)) {
      reject(new Error('Content types must be an array'));
    }
    const configured = types.map(type => {
      const mergedType = type;
      const ids = [];

      if (!mergedType.hasOwnProperty('identifier')) {
        reject(new Error(`Identifier missing in content type '${mergedType.name}'`));
      }

      if (mergedType.hasOwnProperty('identifier')) {
        if (typeof mergedType.identifier !== 'string') {
          reject(new Error(`Identifier in content type '${mergedType.name}' must be a string`));
        }
      }

      const attrs = mergedType.attributes.map(attribute => {
        let plugin = Object.keys(plugins).indexOf(`input-plugin-${attribute.type}`);

        // Reject if input plugin isn't available
        if (plugin === -1) {
          reject(new Error(`Input '${attribute.type}' not found`));
        }

        // Reject if plugin instance doesn't have a name
        if (!attribute.hasOwnProperty('name')) {
          let id = attribute.type;

          if (attribute.hasOwnProperty('id')) {
            id = attribute.id;
          }
          reject(new Error(`Input '${id}' in content type '${type.name}' needs a name`));
        }

        // Reject if plugin instance doesn't have an ID
        if (!attribute.hasOwnProperty('id')) {
          reject(new Error(`Input '${attribute.name}' in content type '${type.name}' needs an ID`));
        }

        // Reject if plugin instance ID is duplicated
        if (ids.indexOf(attribute.id) !== -1) {
          reject(new Error(`Input ID '${attribute.id}' in content type '${type.name}' cannot be duplicated (in '${attribute.name}')`));
        }

        // Reject if ID isn't kebab case
        if (slugify(attribute.id) !== attribute.id) {
          reject(new Error(`Input ID '${attribute.id}' needs to be written in kebab case (e.g. '${slugify(attribute.id)}')`));
        }
        ids.push(attribute.id);

        plugin = _.cloneDeep(plugins[`input-plugin-${attribute.type}`]);

        if (attribute.name) {
          plugin.name = attribute.name;
        }
        if (attribute.description) {
          plugin.description = attribute.description;
        }
        if (attribute.required) {
          plugin.required = requiredLevel(attribute.required);
        }

        // identifier attribute is always required to save
        if (attribute.id === mergedType.identifier) {
          plugin.required = 'save';
        }

        plugin.id = attribute.id;
        plugin.type = attribute.type;

        // Set Default Label from Plugin Name
        if (Object.keys(plugin.inputs).length === 1) {
          const input = Object.keys(plugin.inputs)[0];

          plugin.inputs[input].label = plugin.name;
        }

        // Merge Content Type settings with default configuration for each input
        if (attribute.inputs) {
          Object.keys(attribute.inputs).forEach(attr => {
            if (Object.keys(plugin.inputs).indexOf(attr) > -1) {
              // Merge attribute's options with default
              const merged = merge(plugin.inputs[attr], attribute.inputs[attr]);

              // Override any overriding with defaults
              merged.validation = plugin.inputs[attr].validation;
              merged.type = plugin.inputs[attr].type;

              if (plugin.inputs[attr].hasOwnProperty('script')) {
                merged.script = plugin.inputs[attr].script;
              }

              // Options of attribute overrides default
              if (attribute.inputs[attr].hasOwnProperty('options')) {
                merged.options = attribute.inputs[attr].options;
              }

              // add required if it doesn't exist
              if (!merged.hasOwnProperty('required')) {
                merged.required = plugin.required;
              }
              else {
                merged.required = requiredLevel(merged.required);
              }

              plugin.inputs[attr] = merged;
            }
          });
        }

        // Add Unique ID to each input
        Object.keys(plugin.inputs).forEach(input => {
          plugin.inputs[input].id = uuid.v4();
          plugin.inputs[input].name = `${plugin.id}--${input}`;
        });

        // Sets inputs to min for repeatables
        if (attribute.repeatable) {
          // Unifies the structure of repeatable
          if (typeof attribute.repeatable === 'object') {
            plugin.repeatable = {};
            if (!attribute.repeatable.hasOwnProperty('min')) {
              plugin.repeatable.min = 1;
            }
            else {
              plugin.repeatable.min = attribute.repeatable.min;
            }
            if (!attribute.repeatable.hasOwnProperty('max')) {
              plugin.repeatable.max = Number.MAX_SAFE_INTEGER;
            }
            else {
              plugin.repeatable.max = attribute.repeatable.max;
            }
          }
          else if (attribute.repeatable === true) {
            plugin.repeatable = {
              min: 1,
              max: Number.MAX_SAFE_INTEGER,
            };
          }

          // create instances equal to the value of min
          const pluginInputs = [];
          for (let i = 0; i < plugin.repeatable.min; i++) {
            const inputs = _.cloneDeep(plugin.inputs);
            Object.keys(inputs).forEach(input => {
              inputs[input].id = `${inputs[input].id}--${i}`;
              inputs[input].name = `${inputs[input].name}--${i}`;
            });
            pluginInputs.push(inputs);
          }
          plugin.inputs = pluginInputs;
        }

        return plugin;
      });

      // find attribute which is the identifier
      const contender = attrs.find(attr => {
        return attr.id === mergedType.identifier;
      });

      if (!contender) {
        reject(new Error(`Identifier '${mergedType.identifier}' is not an attribute in content type '${mergedType.name}'.`));
      }

      // check for multiple inputs
      if (Object.keys(contender.inputs).length > 1) {
        reject(new Error(`Identifier '${mergedType.identifier}' in content type '${type.name}' has more than one input. Only single-input attributes may be the identifier.`));
      }

      if (contender.hasOwnProperty('repeatable')) {
        reject(new Error(`Identifier '${mergedType.identifier}' in content type '${type.name}' is repeatable. Only non-repeatable attributes may be the identifier.`));
      }

      if (contender.inputs[Object.keys(contender.inputs)[0]].hasOwnProperty('options')) {
        reject(new Error(`Identifier '${mergedType.identifier}' in content type '${type.name}' has options. Attributes with options may not be the identifier.`));
      }

      mergedType.attributes = attrs;

      return mergedType;
    });

    resolve(configured);
  });
};

module.exports = squish;
