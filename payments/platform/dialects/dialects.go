// Package dialects embeds the ISO 8583 dialect files shipped with the platform.
//
// generic-1987-ascii.json is the platform's reference dialect. The Visa and
// Mastercard files are structural templates: replace them with dialects
// transcribed from the licensed scheme specifications (load them from disk with
// iso8583.LoadSpecFile) before certification.
package dialects

import (
	"embed"
	"fmt"

	"github.com/monolito123/Gooners/payments/platform/pkg/iso8583"
)

//go:embed *.json
var files embed.FS

// Names of the embedded dialects.
const (
	Generic            = "generic-1987-ascii"
	VisaTemplate       = "visa-base1-template"
	MastercardTemplate = "mastercard-cis-template"
)

var fileOf = map[string]string{
	Generic:            "generic-1987-ascii.json",
	VisaTemplate:       "visa-base1.template.json",
	MastercardTemplate: "mastercard-cis.template.json",
}

// Load returns an embedded dialect by name.
func Load(name string) (*iso8583.Spec, error) {
	f, ok := fileOf[name]
	if !ok {
		return nil, fmt.Errorf("dialects: unknown dialect %q", name)
	}
	b, err := files.ReadFile(f)
	if err != nil {
		return nil, err
	}
	return iso8583.ParseSpec(b)
}

// MustLoad is Load for package initialisation and tests.
func MustLoad(name string) *iso8583.Spec {
	s, err := Load(name)
	if err != nil {
		panic(err)
	}
	return s
}
