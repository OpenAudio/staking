const path = require('path')
const templatePath = path.resolve(__dirname, 'svgr-template.cjs')

module.exports = {
  template: require(templatePath),
  titleProp: true,
  descProp: true,
  replaceAttrValues: {
    '#FF0000': '{props.fill}'
  }
}
